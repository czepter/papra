import { and, eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { documentsTagsTable, tagsTable } from '../tags/tags.table';
import { ids, setupMcpTest, testId } from './mcp.test-utils';

type Db = Awaited<ReturnType<typeof setupMcpTest>>['db'];

const tagNotFound = { error: { message: 'Tag not found', code: 'tags.not_found' } };
const documentNotFound = { error: { message: 'Document not found.', code: 'document.not_found' } };

async function getTag({ db, tagId }: { db: Db; tagId: string }) {
  const [tag] = await db.select().from(tagsTable).where(eq(tagsTable.id, tagId));

  return tag;
}

async function hasLink({ db, documentId, tagId }: { db: Db; documentId: string; tagId: string }) {
  const rows = await db
    .select()
    .from(documentsTagsTable)
    .where(and(eq(documentsTagsTable.documentId, documentId), eq(documentsTagsTable.tagId, tagId)));

  return rows.length > 0;
}

describe('mcp tag tools', () => {
  describe('list_tags', () => {
    test('returns the tags of the organization with their document counts, and no tag of another organization', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'list_tags',
        args: { organizationId: ids.orgA },
      });

      expect(isError).to.eql(false);
      expect(
        data.tags
          .map(
            ({
              id,
              name,
              documentsCount,
            }: {
              id: string;
              name: string;
              documentsCount: number;
            }) => ({ id, name, documentsCount }),
          )
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)),
      ).to.eql([
        { id: ids.tagA1, name: 'Finance', documentsCount: 1 },
        { id: ids.tagA2, name: 'Travel', documentsCount: 0 },
      ]);
      expect(data.tags[0]).to.include({ organizationId: ids.orgA });
      expect(JSON.stringify(data)).not.to.include('Secret');
    });
  });

  describe('create_tag', () => {
    test('creates the tag with the normalised color and a trimmed name', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'create_tag',
        args: {
          organizationId: ids.orgA,
          name: '  Invoices  ',
          color: '#aabbcc',
          description: ' paid ones ',
        },
      });

      expect(isError).to.eql(false);
      expect(data.tag).to.include({
        organizationId: ids.orgA,
        name: 'Invoices',
        color: '#AABBCC',
        description: 'paid ones',
      });
      expect(await getTag({ db, tagId: data.tag.id })).to.include({
        organizationId: ids.orgA,
        name: 'Invoices',
      });
    });

    test('refuses an invalid color, an empty name and a name over 64 characters', async () => {
      const { callTool } = await setupMcpTest();

      for (const overrides of [
        { color: 'red' },
        { color: '#12345' },
        { name: '' },
        { name: '   ' },
        { name: 'a'.repeat(65) },
      ]) {
        const { isError, text } = await callTool({
          name: 'create_tag',
          args: { organizationId: ids.orgA, name: 'Ok', color: '#112233', ...overrides },
        });

        expect(isError, JSON.stringify(overrides)).to.eql(true);
        expect(text, JSON.stringify(overrides)).to.include('Invalid arguments');
      }
    });

    test('a duplicate name gives the public already exists error', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'create_tag',
        args: { organizationId: ids.orgA, name: 'Finance', color: '#112233' },
      });

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('tags.already_exists');
    });

    test('goes through the createTag usecase: the maximum number of tags per organization applies', async () => {
      // Organization A has 2 tags, organization B has 1
      const { callTool, bobToken } = await setupMcpTest({
        config: { tags: { maxTagsPerOrganization: 2 } },
      });

      const { isError, data } = await callTool({
        name: 'create_tag',
        args: { organizationId: ids.orgA, name: 'One too many', color: '#112233' },
      });

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('tags.organization_limit_reached');

      // The limit is per organization: organization B still has room
      const other = await callTool({
        name: 'create_tag',
        args: { organizationId: ids.orgB, name: 'Fits', color: '#112233' },
        token: bobToken,
      });
      expect(other.isError).to.eql(false);
    });
  });

  describe('update_tag', () => {
    test('updates only the given fields', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'update_tag',
        args: {
          organizationId: ids.orgA,
          tagId: ids.tagA1,
          name: 'Money',
          description: 'all the money',
        },
      });

      expect(isError).to.eql(false);
      expect(data.tag).to.include({
        id: ids.tagA1,
        name: 'Money',
        description: 'all the money',
        color: '#00FF00',
      });
      expect(await getTag({ db, tagId: ids.tagA1 })).to.include({
        name: 'Money',
        color: '#00FF00',
      });
    });

    test('a tag of another organization is not found and stays unchanged', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await getTag({ db, tagId: ids.tagB1 });

      const { isError, data } = await callTool({
        name: 'update_tag',
        args: { organizationId: ids.orgA, tagId: ids.tagB1, name: 'Hijacked', color: '#000000' },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(tagNotFound);
      expect(await getTag({ db, tagId: ids.tagB1 })).to.eql(before);
    });

    test('an unknown tag gives the same not found error', async () => {
      const { callTool } = await setupMcpTest();

      const { data } = await callTool({
        name: 'update_tag',
        args: { organizationId: ids.orgA, tagId: testId('tag', 'missing'), name: 'x' },
      });

      expect(data).to.eql(tagNotFound);
    });
  });

  describe('delete_tag', () => {
    test('deletes the tag and its links to documents', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'delete_tag',
        args: { organizationId: ids.orgA, tagId: ids.tagA1 },
      });

      expect(isError).to.eql(false);
      expect(data).to.eql({ deleted: true });
      expect(await getTag({ db, tagId: ids.tagA1 })).to.eql(undefined);
      expect(await hasLink({ db, documentId: ids.docA1, tagId: ids.tagA1 })).to.eql(false);
    });

    test('a tag of another organization is not found and still exists', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'delete_tag',
        args: { organizationId: ids.orgA, tagId: ids.tagB1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(tagNotFound);
      expect(await getTag({ db, tagId: ids.tagB1 })).to.include({
        organizationId: ids.orgB,
        name: 'Secret',
      });
    });
  });

  describe('add_document_tag', () => {
    test('attaches the tag to the document', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'add_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docA2, tagId: ids.tagA1 },
      });

      expect(isError).to.eql(false);
      expect(data).to.eql({ added: true });
      expect(await hasLink({ db, documentId: ids.docA2, tagId: ids.tagA1 })).to.eql(true);
    });

    test('a tag the document already has gives the public conflict error', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'add_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docA1, tagId: ids.tagA1 },
      });

      expect(isError).to.eql(true);
      expect(data.error.code).to.eql('documents.already_has_tag');
    });

    test('a document of another organization is not found and no link is created', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'add_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docB1, tagId: ids.tagA1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(documentNotFound);
      expect(await hasLink({ db, documentId: ids.docB1, tagId: ids.tagA1 })).to.eql(false);
    });

    test('a tag of another organization is not found and no link is created', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'add_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docA2, tagId: ids.tagB1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(tagNotFound);
      expect(await hasLink({ db, documentId: ids.docA2, tagId: ids.tagB1 })).to.eql(false);
    });
  });

  describe('remove_document_tag', () => {
    test('detaches the tag and keeps the tag itself', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'remove_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docA1, tagId: ids.tagA1 },
      });

      expect(isError).to.eql(false);
      expect(data).to.eql({ removed: true });
      expect(await hasLink({ db, documentId: ids.docA1, tagId: ids.tagA1 })).to.eql(false);
      expect(await getTag({ db, tagId: ids.tagA1 })).to.include({ name: 'Finance' });
    });

    test('a document or a tag of another organization is not found and no link is removed', async () => {
      const { callTool, db } = await setupMcpTest();
      await db.insert(documentsTagsTable).values({ documentId: ids.docB1, tagId: ids.tagB1 });

      const foreignDocument = await callTool({
        name: 'remove_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docB1, tagId: ids.tagA1 },
      });
      const foreignTag = await callTool({
        name: 'remove_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docA1, tagId: ids.tagB1 },
      });
      const bothForeign = await callTool({
        name: 'remove_document_tag',
        args: { organizationId: ids.orgA, documentId: ids.docB1, tagId: ids.tagB1 },
      });

      expect(foreignDocument.data).to.eql(documentNotFound);
      expect(foreignTag.data).to.eql(tagNotFound);
      expect(bothForeign.data).to.eql(documentNotFound);
      expect(await hasLink({ db, documentId: ids.docB1, tagId: ids.tagB1 })).to.eql(true);
      expect(await hasLink({ db, documentId: ids.docA1, tagId: ids.tagA1 })).to.eql(true);
    });
  });
});
