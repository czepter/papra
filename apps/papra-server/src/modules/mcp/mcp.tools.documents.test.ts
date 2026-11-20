import { Buffer } from 'node:buffer';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { documentsTable } from '../documents/documents.table';
import { MCP_UPLOAD_MAX_ENCODED_SIZE } from './mcp.constants';
import { DOC_A1_CONTENT, DOC_B1_CONTENT, ids, setupMcpTest, testId } from './mcp.test-utils';

const documentNotFound = { error: { message: 'Document not found.', code: 'document.not_found' } };

async function getDocumentRow({
  db,
  documentId,
}: {
  db: Awaited<ReturnType<typeof setupMcpTest>>['db'];
  documentId: string;
}) {
  const [document] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.id, documentId));

  return document;
}

describe('mcp document tools', () => {
  describe('search_documents', () => {
    test('lists the documents of the organization only, with tags and custom properties and without the full text', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgA },
      });

      expect(isError).to.eql(false);
      expect(data.documentsCount).to.eql(2);
      expect(data.documents.map(({ id }: { id: string }) => id).sort()).to.eql(
        [ids.docA1, ids.docA2].sort(),
      );

      const invoice = data.documents.find(({ id }: { id: string }) => id === ids.docA1);
      expect(invoice.tags.map(({ name }: { name: string }) => name)).to.eql(['Finance']);
      expect(
        invoice.customProperties.find(({ key }: { key: string }) => key === 'reference').value,
      ).to.eql('INV-1');
      expect(invoice).not.to.have.property('content');
      expect(invoice).not.to.have.property('originalStorageKey');
      expect(JSON.stringify(data)).not.to.include(DOC_B1_CONTENT);
    });

    test('searchQuery filters, and a term matching documents of both organizations returns the caller ones only', async () => {
      const { callTool, bobToken } = await setupMcpTest();

      const holiday = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgA, searchQuery: 'Holiday' },
      });
      expect(holiday.data.documents.map(({ id }: { id: string }) => id)).to.eql([ids.docA2]);
      expect(holiday.data.documentsCount).to.eql(1);

      // 'letter' only exists in organization B, searching it from organization A finds nothing
      const foreign = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgA, searchQuery: 'letter' },
      });
      expect(foreign.data).to.eql({ documents: [], documentsCount: 0 });

      const own = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgB, searchQuery: 'letter' },
        token: bobToken,
      });
      expect(own.data.documents.map(({ id }: { id: string }) => id)).to.eql([ids.docB1]);
    });

    test('the page size defaults to 25 and is capped at 100', async () => {
      const { callTool, db } = await setupMcpTest();
      await db.insert(documentsTable).values(
        Array.from({ length: 30 }, (_, index) => ({
          id: testId('doc', `bulk${String(index).padStart(3, '0')}`),
          organizationId: ids.orgA,
          createdBy: ids.alice,
          name: `Bulk ${index}`,
          originalName: `bulk-${index}.txt`,
          content: 'bulk',
          originalStorageKey: `bulk/${index}`,
          mimeType: 'text/plain',
          originalSize: 1,
          originalSha256Hash: `bulk-hash-${index}`,
        })),
      );

      const first = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgA },
      });
      expect(first.data.documents).to.have.length(25);
      expect(first.data.documentsCount).to.eql(32);

      const second = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgA, pageIndex: 1, pageSize: 25 },
      });
      expect(second.data.documents).to.have.length(7);

      const tooLarge = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgA, pageSize: 101 },
      });
      expect(tooLarge.isError).to.eql(true);
      expect(tooLarge.text).to.include('pageSize');

      const maximum = await callTool({
        name: 'search_documents',
        args: { organizationId: ids.orgA, pageSize: 100 },
      });
      expect(maximum.data.documents).to.have.length(32);
    });
  });

  describe('get_document', () => {
    test('returns the metadata with the content length and without the content', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'get_document',
        args: { organizationId: ids.orgA, documentId: ids.docA1 },
      });

      expect(isError).to.eql(false);
      expect(data.document).to.include({
        id: ids.docA1,
        name: 'Acme invoice',
        contentLength: DOC_A1_CONTENT.length,
      });
      expect(data.document).not.to.have.property('content');
      expect(data.document.tags).to.have.length(1);
    });

    test('a document of another organization is not found, even with the id of an organization the caller is in', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data, text } = await callTool({
        name: 'get_document',
        args: { organizationId: ids.orgA, documentId: ids.docB1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(documentNotFound);
      expect(text).not.to.include('Bob letter');
    });

    test('an unknown document gives the same answer as a foreign one', async () => {
      const { callTool } = await setupMcpTest();

      const { data } = await callTool({
        name: 'get_document',
        args: { organizationId: ids.orgA, documentId: testId('doc', 'missing') },
      });

      expect(data).to.eql(documentNotFound);
    });
  });

  describe('read_document_content', () => {
    test('returns a slice of the text with the total length and whether more follows', async () => {
      const { callTool } = await setupMcpTest();
      const args = { organizationId: ids.orgA, documentId: ids.docA1 };

      const whole = await callTool({ name: 'read_document_content', args });
      expect(whole.data).to.eql({
        documentId: ids.docA1,
        content: DOC_A1_CONTENT,
        offset: 0,
        limit: 20_000,
        totalLength: DOC_A1_CONTENT.length,
        hasMore: false,
      });

      const first = await callTool({
        name: 'read_document_content',
        args: { ...args, offset: 0, limit: 10 },
      });
      expect(first.data).to.include({
        content: DOC_A1_CONTENT.slice(0, 10),
        hasMore: true,
        totalLength: DOC_A1_CONTENT.length,
      });

      const last = await callTool({
        name: 'read_document_content',
        args: { ...args, offset: DOC_A1_CONTENT.length - 5, limit: 10 },
      });
      expect(last.data).to.include({ content: DOC_A1_CONTENT.slice(-5), hasMore: false });

      const beyond = await callTool({
        name: 'read_document_content',
        args: { ...args, offset: DOC_A1_CONTENT.length + 100 },
      });
      expect(beyond.data).to.include({ content: '', hasMore: false });
    });

    test('the limit is capped at 100,000 characters and the offset cannot be negative', async () => {
      const { callTool } = await setupMcpTest();
      const args = { organizationId: ids.orgA, documentId: ids.docA1 };

      const tooLarge = await callTool({
        name: 'read_document_content',
        args: { ...args, limit: 100_001 },
      });
      expect(tooLarge.isError).to.eql(true);
      expect(tooLarge.text).to.include('limit');

      expect(
        (await callTool({ name: 'read_document_content', args: { ...args, limit: 100_000 } }))
          .isError,
      ).to.eql(false);
      expect(
        (await callTool({ name: 'read_document_content', args: { ...args, limit: 0 } })).isError,
      ).to.eql(true);
      expect(
        (await callTool({ name: 'read_document_content', args: { ...args, offset: -1 } })).isError,
      ).to.eql(true);
    });

    test('a document of another organization is not found and its text is not returned', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data, text } = await callTool({
        name: 'read_document_content',
        args: { organizationId: ids.orgA, documentId: ids.docB1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(documentNotFound);
      expect(text).not.to.include(DOC_B1_CONTENT);
    });
  });

  describe('update_document', () => {
    test('updates the name, the content and the notes', async () => {
      const { callTool, db } = await setupMcpTest();
      const args = { organizationId: ids.orgA, documentId: ids.docA1 };

      const { isError, data } = await callTool({
        name: 'update_document',
        args: { ...args, name: 'Renamed', content: 'new text', notes: 'a note' },
      });

      expect(isError).to.eql(false);
      expect(data.document).to.include({
        id: ids.docA1,
        name: 'Renamed',
        notes: 'a note',
        contentLength: 'new text'.length,
      });
      expect(data.document).not.to.have.property('content');

      const row = await getDocumentRow({ db, documentId: ids.docA1 });
      expect(row).to.include({ name: 'Renamed', content: 'new text', notes: 'a note' });
    });

    test('sets the document date from an ISO string and clears it with null', async () => {
      const { callTool, db } = await setupMcpTest();
      const args = { organizationId: ids.orgA, documentId: ids.docA1 };

      const set = await callTool({
        name: 'update_document',
        args: { ...args, documentDate: '2024-01-31T10:00:00.000Z' },
      });
      expect(set.isError).to.eql(false);
      expect(
        (await getDocumentRow({ db, documentId: ids.docA1 }))?.documentDate?.toISOString(),
      ).to.eql('2024-01-31T10:00:00.000Z');

      const dateOnly = await callTool({
        name: 'update_document',
        args: { ...args, documentDate: '2024-02-01' },
      });
      expect(dateOnly.isError).to.eql(false);
      expect(
        (await getDocumentRow({ db, documentId: ids.docA1 }))?.documentDate?.toISOString(),
      ).to.eql('2024-02-01T00:00:00.000Z');

      const cleared = await callTool({
        name: 'update_document',
        args: { ...args, documentDate: null },
      });
      expect(cleared.isError).to.eql(false);
      expect((await getDocumentRow({ db, documentId: ids.docA1 }))?.documentDate).to.eql(null);
    });

    test('requires at least one field, like the REST route', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, text } = await callTool({
        name: 'update_document',
        args: { organizationId: ids.orgA, documentId: ids.docA1 },
      });

      expect(isError).to.eql(true);
      expect(text).to.include(
        "At least one of 'name', 'content', 'documentDate' or 'notes' must be provided",
      );
    });

    test('refuses an empty name and a name over 255 characters', async () => {
      const { callTool } = await setupMcpTest();
      const args = { organizationId: ids.orgA, documentId: ids.docA1 };

      expect(
        (await callTool({ name: 'update_document', args: { ...args, name: '' } })).isError,
      ).to.eql(true);
      expect(
        (await callTool({ name: 'update_document', args: { ...args, name: 'a'.repeat(256) } }))
          .isError,
      ).to.eql(true);
    });

    test('a document of another organization is not found and stays unchanged', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await getDocumentRow({ db, documentId: ids.docB1 });

      const { isError, data } = await callTool({
        name: 'update_document',
        args: { organizationId: ids.orgA, documentId: ids.docB1, name: 'Hijacked', content: 'x' },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(documentNotFound);
      expect(await getDocumentRow({ db, documentId: ids.docB1 })).to.eql(before);
    });

    test('emits the document updated event with the user of the api key', async () => {
      const { callTool, serverDependencies } = await setupMcpTest();
      const handler = vi.fn();
      serverDependencies.eventServices.onEvent({
        eventName: 'document.updated',
        handlerName: 'test',
        handler,
      });

      await callTool({
        name: 'update_document',
        args: { organizationId: ids.orgA, documentId: ids.docA1, name: 'Evented' },
      });

      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      expect(handler.mock.calls[0]![0].userId).to.eql(ids.alice);
    });
  });

  describe('upload_document', () => {
    const upload = (organizationId: string, overrides: Record<string, unknown> = {}) => ({
      organizationId,
      fileName: 'note.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('hello from mcp').toString('base64'),
      ...overrides,
    });

    test('stores the file as a document that is listed afterwards', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({ name: 'upload_document', args: upload(ids.orgA) });

      expect(isError).to.eql(false);
      expect(data.document).to.include({
        organizationId: ids.orgA,
        name: 'note.txt',
        mimeType: 'text/plain',
        originalSize: 'hello from mcp'.length,
        createdBy: ids.alice,
      });
      expect(data.document).not.to.have.property('originalStorageKey');
      expect(data.document).not.to.have.property('content');

      const row = await getDocumentRow({ db, documentId: data.document.id });
      expect(row?.organizationId).to.eql(ids.orgA);

      const list = await callTool({ name: 'search_documents', args: { organizationId: ids.orgA } });
      expect(list.data.documents.map(({ id }: { id: string }) => id)).to.include(data.document.id);
    });

    test('the stored bytes are the decoded ones', async () => {
      const { callTool, serverDependencies, db } = await setupMcpTest();
      const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);

      const { data } = await callTool({
        name: 'upload_document',
        args: upload(ids.orgA, {
          fileName: 'blob.bin',
          mimeType: 'application/octet-stream',
          contentBase64: bytes.toString('base64'),
        }),
      });
      const row = await getDocumentRow({ db, documentId: data.document.id });

      const { fileStream } = await serverDependencies.documentsStorageService.getFileStream({
        storageKey: row!.originalStorageKey,
        fileEncryptionAlgorithm: row!.fileEncryptionAlgorithm,
        fileEncryptionKekVersion: row!.fileEncryptionKekVersion,
        fileEncryptionKeyWrapped: row!.fileEncryptionKeyWrapped,
      });
      const chunks: Buffer[] = [];
      for await (const chunk of fileStream) {
        chunks.push(Buffer.from(chunk));
      }

      expect(Buffer.concat(chunks).equals(bytes)).to.eql(true);
      expect(data.document.originalSize).to.eql(bytes.length);
    });

    test('rejects base64 that is not valid, without storing anything', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await db.select().from(documentsTable);

      for (const contentBase64 of [
        'not base64!',
        'aGVsbG8',
        'aGVs bG8=',
        'aGVsbG8=\n',
        'a-_b',
        'aGVsbG8===',
        '=aGVsbG8',
      ]) {
        const { isError, data } = await callTool({
          name: 'upload_document',
          args: upload(ids.orgA, { contentBase64 }),
        });

        expect(isError, contentBase64).to.eql(true);
        expect(data.error.code, contentBase64).to.eql('mcp.invalid_base64');
      }

      expect(await db.select().from(documentsTable)).to.eql(before);
    });

    test('rejects an encoded size over the 10 MB cap before decoding and without echoing the content', async () => {
      const { callTool } = await setupMcpTest();
      const contentBase64 = 'A'.repeat(MCP_UPLOAD_MAX_ENCODED_SIZE + 4);

      const { isError, text } = await callTool({
        name: 'upload_document',
        args: upload(ids.orgA, { contentBase64 }),
      });

      expect(isError).to.eql(true);
      expect(text).to.include('contentBase64');
      expect(text.length).to.be.lessThan(500);
    });

    test('accepts an encoded size of exactly the cap when the plan allows it', async () => {
      const { callTool } = await setupMcpTest({
        config: { documentsStorage: { maxUploadSize: 0 } },
      });
      // 10 MiB is a multiple of 4 and the characters are valid base64: 7.5 MiB of zero bytes
      const contentBase64 = 'A'.repeat(MCP_UPLOAD_MAX_ENCODED_SIZE);

      const { isError, data } = await callTool({
        name: 'upload_document',
        args: upload(ids.orgA, {
          contentBase64,
          mimeType: 'application/octet-stream',
          fileName: 'zeros.bin',
        }),
      });

      expect(isError).to.eql(false);
      expect(data.document.originalSize).to.eql((MCP_UPLOAD_MAX_ENCODED_SIZE / 4) * 3);
    });

    test('rejects a decoded size over the maxFileSize of the plan with the document size error', async () => {
      const { callTool, db } = await setupMcpTest({
        config: { documentsStorage: { maxUploadSize: 10 } },
      });
      const before = await db.select().from(documentsTable);

      const { isError, data } = await callTool({
        name: 'upload_document',
        args: upload(ids.orgA, { contentBase64: Buffer.from('12345678901').toString('base64') }),
      });

      expect(isError).to.eql(true);
      expect(data).to.eql({
        error: { message: 'Document size too large.', code: 'document.size_too_large' },
      });
      expect(await db.select().from(documentsTable)).to.eql(before);

      const exact = await callTool({
        name: 'upload_document',
        args: upload(ids.orgA, { contentBase64: Buffer.from('1234567890').toString('base64') }),
      });
      expect(exact.isError).to.eql(false);
    });

    test('surfaces the storage quota error of the usecase with its public message', async () => {
      const { callTool, db } = await setupMcpTest({
        config: { organizationPlans: { isFreePlanUnlimited: false } },
      });
      await db.insert(documentsTable).values({
        id: testId('doc', 'huge'),
        organizationId: ids.orgA,
        createdBy: ids.alice,
        name: 'Huge',
        originalName: 'huge.bin',
        content: '',
        originalStorageKey: 'huge',
        mimeType: 'application/octet-stream',
        originalSize: 600 * 1024 * 1024,
        originalSha256Hash: 'huge-hash',
      });

      const { isError, data } = await callTool({ name: 'upload_document', args: upload(ids.orgA) });

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('organization.document_storage_limit_reached');
      expect(data.error.message).to.be.a('string').and.not.to.eql('');
    });

    test('refuses an empty file name, an empty mime type and an empty content', async () => {
      const { callTool } = await setupMcpTest();

      for (const overrides of [
        { fileName: '' },
        { mimeType: '' },
        { contentBase64: '' },
        { fileName: 'a'.repeat(256) },
      ]) {
        expect(
          (await callTool({ name: 'upload_document', args: upload(ids.orgA, overrides) })).isError,
          JSON.stringify(overrides),
        ).to.eql(true);
      }
    });

    test('passes the file name through the usecase: an unsafe name is stored under a generated key', async () => {
      const { callTool, db } = await setupMcpTest();

      const { data } = await callTool({
        name: 'upload_document',
        args: upload(ids.orgA, { fileName: '../../etc/passwd.txt' }),
      });

      const row = await getDocumentRow({ db, documentId: data.document.id });
      expect(row?.originalStorageKey.startsWith(`${ids.orgA}/`)).to.eql(true);
      expect(row?.originalStorageKey).not.to.include('..');
    });

    test('uploading to an organization of another user is refused and stores nothing', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await db.select().from(documentsTable);

      const { isError, data } = await callTool({ name: 'upload_document', args: upload(ids.orgB) });

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('user.not_in_organization');
      expect(await db.select().from(documentsTable)).to.eql(before);
    });
  });

  describe('logging', () => {
    test('neither the uploaded base64, nor a document content, nor its text end up in the logs, including on an internal error', async () => {
      const { callTool, serverDependencies } = await setupMcpTest();
      const marker = 'TOP-SECRET-MARKER-PAYLOAD';
      const contentBase64 = Buffer.from(marker).toString('base64');
      const written: string[] = [];
      const originalEnv = process.env.NODE_ENV;
      // Logs are discarded in the test env, enable them to capture what would be written
      process.env.NODE_ENV = 'production';
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        written.push(args.map(String).join(' '));
      });
      const storageSpy = vi
        .spyOn(serverDependencies.documentsStorageService, 'saveFile')
        .mockRejectedValue(new Error('storage exploded'));

      let uploadResult;
      try {
        await callTool({
          name: 'update_document',
          args: { organizationId: ids.orgA, documentId: ids.docA1, content: marker },
        });
        await callTool({
          name: 'read_document_content',
          args: { organizationId: ids.orgA, documentId: ids.docA1 },
        });
        uploadResult = await callTool({
          name: 'upload_document',
          args: {
            organizationId: ids.orgA,
            fileName: 'secret.txt',
            mimeType: 'text/plain',
            contentBase64,
          },
        });
      } finally {
        storageSpy.mockRestore();
        stdoutSpy.mockRestore();
        consoleSpy.mockRestore();
        process.env.NODE_ENV = originalEnv;
      }

      // The internal error really happened and reached the model as the generic message only
      expect(uploadResult.isError).to.eql(true);
      expect(uploadResult.text).to.eql('An error occurred');
      expect(written.join('\n')).to.include('MCP tool failed');
      expect(written.join('\n')).not.to.include(marker);
      expect(written.join('\n')).not.to.include(contentBase64);
    });
  });
});
