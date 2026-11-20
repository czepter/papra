import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { documentsTable } from '../documents/documents.table';
import { createInMemoryTaskServices } from '../tasks/tasks.test-utils';
import { ids, setupMcpTest } from './mcp.test-utils';

async function setupReprocessing({
  config = {},
}: { config?: NonNullable<Parameters<typeof setupMcpTest>[0]>['config'] } = {}) {
  const taskServices = createInMemoryTaskServices();
  const scheduleJob = vi
    .spyOn(taskServices, 'scheduleJob')
    .mockResolvedValue({ jobId: 'job_reprocess_1' } as never);
  const context = await setupMcpTest({ config, dependencies: { taskServices } });

  return { ...context, scheduleJob };
}

const args = (overrides: Record<string, unknown> = {}) => ({
  organizationId: ids.orgA,
  documentId: ids.docA1,
  ...overrides,
});

describe('mcp reprocess_document', () => {
  test('schedules the content extraction like the REST route does', async () => {
    const { callTool, scheduleJob } = await setupReprocessing();

    const { isError, data } = await callTool({ name: 'reprocess_document', args: args() });

    expect(isError).to.eql(false);
    expect(data).to.eql({ scheduled: true });
    expect(scheduleJob).toHaveBeenCalledExactlyOnceWith({
      taskName: 'extract-document-file-content',
      data: expect.objectContaining({ documentId: ids.docA1, organizationId: ids.orgA }),
    });
  });

  test('is refused when reprocessing is disabled in the config', async () => {
    const { callTool, scheduleJob } = await setupReprocessing({
      config: { documents: { isReprocessingEnabled: false } },
    });

    const { isError, data } = await callTool({ name: 'reprocess_document', args: args() });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('document.reprocessing_disabled');
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('a deleted document is not found', async () => {
    const { callTool, scheduleJob, db } = await setupReprocessing();
    await db
      .update(documentsTable)
      .set({ isDeleted: true })
      .where(eq(documentsTable.id, ids.docA1));

    const { isError, data } = await callTool({ name: 'reprocess_document', args: args() });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('document.not_found');
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('a document of another organization is not found and no job is scheduled', async () => {
    const { callTool, scheduleJob } = await setupReprocessing();

    const { isError, data } = await callTool({
      name: 'reprocess_document',
      args: args({ documentId: ids.docB1 }),
    });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('document.not_found');
    expect(scheduleJob).not.toHaveBeenCalled();
  });

  test('stops at the per-organization rate limit and says how long to wait', async () => {
    const { callTool, scheduleJob } = await setupReprocessing({
      config: { documents: { reprocessingRateLimit: { maxHits: 2 } } },
    });

    for (const _ of [1, 2]) {
      const { isError, text } = await callTool({ name: 'reprocess_document', args: args() });
      expect(isError, text).to.eql(false);
    }

    const { isError, data } = await callTool({ name: 'reprocess_document', args: args() });

    expect(isError).to.eql(true);
    expect(data.error.code).to.eql('server.too_many_requests');
    expect(data.error.message).to.match(/Retry in \d+ seconds/);
    expect(scheduleJob).toHaveBeenCalledTimes(2);
  });

  test('the description mentions the rate limit and points to get_document', async () => {
    const { listTools } = await setupReprocessing();

    const tool = (await listTools()).find(({ name }) => name === 'reprocess_document');

    expect(tool?.description).to.include('rate limited');
    expect(tool?.description).to.include('get_document');
  });
});
