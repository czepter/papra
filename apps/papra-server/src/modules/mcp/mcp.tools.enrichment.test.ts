import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { documentsTable } from '../documents/documents.table';
import { organizationSettingsTable } from '../organizations/organization-settings/organization-settings.tables';
import { createInMemoryTaskServices } from '../tasks/tasks.test-utils';
import { ids, setupMcpTest } from './mcp.test-utils';

const enabledConfig = { ai: { isEnabled: true }, autoTagging: { isEnabled: true } };

async function setupEnrichment({
  config = enabledConfig,
  enableForOrganization = true,
}: {
  config?: NonNullable<Parameters<typeof setupMcpTest>[0]>['config'];
  enableForOrganization?: boolean;
} = {}) {
  const taskServices = createInMemoryTaskServices();
  const scheduleJob = vi
    .spyOn(taskServices, 'scheduleJob')
    .mockResolvedValue({ jobId: 'job_enrichment_1' } as never);
  const context = await setupMcpTest({ config, dependencies: { taskServices } });

  if (enableForOrganization) {
    await context.db.insert(organizationSettingsTable).values([
      { organizationId: ids.orgA, aiAutoTaggingEnabled: true },
      { organizationId: ids.orgB, aiAutoTaggingEnabled: true },
    ]);
  }

  return { ...context, scheduleJob };
}

const args = (overrides: Record<string, unknown> = {}) => ({
  organizationId: ids.orgA,
  documentId: ids.docA1,
  capabilities: ['auto-tagging'],
  ...overrides,
});

describe('mcp enrich_document', () => {
  test('schedules the enrichment and returns the task id', async () => {
    const { callTool, scheduleJob } = await setupEnrichment();

    const { isError, data } = await callTool({ name: 'enrich_document', args: args() });

    expect(isError).to.eql(false);
    expect(data).to.eql({ taskId: 'job_enrichment_1' });
    expect(scheduleJob).toHaveBeenCalledExactlyOnceWith({
      taskName: 'enrich-document',
      data: { documentId: ids.docA1, organizationId: ids.orgA, capabilities: ['auto-tagging'] },
    });
  });

  test('is refused when AI features are disabled in the config, as the REST route does', async () => {
    const { callTool, scheduleJob } = await setupEnrichment({
      config: { ai: { isEnabled: false }, autoTagging: { isEnabled: true } },
    });

    const { isError, data } = await callTool({ name: 'enrich_document', args: args() });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('document_enrichment.disabled');
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('is refused when auto-tagging is not enabled for the organization', async () => {
    const { callTool, scheduleJob } = await setupEnrichment({ enableForOrganization: false });

    const { isError, data } = await callTool({ name: 'enrich_document', args: args() });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('document_enrichment.disabled');
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('is refused for a document without extracted text', async () => {
    const { callTool, scheduleJob, db } = await setupEnrichment();
    await db.update(documentsTable).set({ content: '  ' }).where(eq(documentsTable.id, ids.docA1));

    const { isError, data } = await callTool({ name: 'enrich_document', args: args() });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('document_enrichment.content_required');
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('a deleted document is not found', async () => {
    const { callTool, scheduleJob, db } = await setupEnrichment();
    await db
      .update(documentsTable)
      .set({ isDeleted: true })
      .where(eq(documentsTable.id, ids.docA1));

    const { isError, data } = await callTool({ name: 'enrich_document', args: args() });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('document.not_found');
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('a document of another organization is not found and no job is scheduled', async () => {
    const { callTool, scheduleJob } = await setupEnrichment();

    const { isError, data } = await callTool({
      name: 'enrich_document',
      args: args({ documentId: ids.docB1 }),
    });

    expect(isError).to.eql(true);
    expect(data).to.eql({ error: { message: 'Document not found.', code: 'document.not_found' } });
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('refuses no capability and an unknown capability', async () => {
    const { callTool, scheduleJob } = await setupEnrichment();

    for (const capabilities of [[], ['summarize'], 'auto-tagging']) {
      const { isError, text } = await callTool({
        name: 'enrich_document',
        args: args({ capabilities }),
      });

      expect(isError, JSON.stringify(capabilities)).to.eql(true);
      expect(text, JSON.stringify(capabilities)).to.include('capabilities');
    }
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('the description says there is no status tool and points to get_document', async () => {
    const { listTools } = await setupEnrichment();

    const tool = (await listTools()).find(({ name }) => name === 'enrich_document');

    expect(tool?.description).to.include('no status tool');
    expect(tool?.description).to.include('get_document');
  });
});
