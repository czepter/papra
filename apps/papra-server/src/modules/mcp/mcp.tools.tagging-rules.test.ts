import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { API_KEY_PERMISSIONS_VALUES } from '../api-keys/api-keys.constants';
import {
  taggingRuleActionsTable,
  taggingRuleConditionsTable,
  taggingRulesTable,
} from '../tagging-rules/tagging-rules.tables';
import { createInMemoryTaskServices } from '../tasks/tasks.test-utils';
import { ids, insertApiKey, setupMcpTest, snapshotDatabase, testId } from './mcp.test-utils';

type Db = Awaited<ReturnType<typeof setupMcpTest>>['db'];

const ruleNotFound = {
  error: { message: 'Tagging rule not found', code: 'tagging-rules.not-found' },
};
const tagNotFound = { error: { message: 'Tag not found', code: 'tags.not_found' } };

async function getRuleRows({ db, taggingRuleId }: { db: Db; taggingRuleId: string }) {
  const [rules, conditions, actions] = await Promise.all([
    db.select().from(taggingRulesTable).where(eq(taggingRulesTable.id, taggingRuleId)),
    db
      .select()
      .from(taggingRuleConditionsTable)
      .where(eq(taggingRuleConditionsTable.taggingRuleId, taggingRuleId)),
    db
      .select()
      .from(taggingRuleActionsTable)
      .where(eq(taggingRuleActionsTable.taggingRuleId, taggingRuleId)),
  ]);

  return { rules, conditions, actions };
}

const ruleBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Travel docs',
  description: 'Tickets',
  enabled: false,
  conditionMatchMode: 'any',
  conditions: [
    { field: 'name', operator: 'starts_with', value: 'ticket' },
    { field: 'content', operator: 'contains', value: 'boarding' },
  ],
  tagIds: [ids.tagA2],
  ...overrides,
});

describe('mcp tagging rule tools', () => {
  describe('list_tagging_rules', () => {
    test('returns the rules of the organization with conditions and tags, and none of another organization', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'list_tagging_rules',
        args: { organizationId: ids.orgA },
      });

      expect(isError).to.eql(false);
      expect(data.taggingRules).to.have.length(1);
      expect(data.taggingRules[0]).to.include({ id: ids.ruleA1, name: 'Invoices' });
      expect(data.taggingRules[0].conditions[0]).to.include({
        field: 'name',
        operator: 'contains',
        value: 'invoice',
      });
      expect(data.taggingRules[0].actions[0].tag).to.include({ id: ids.tagA1, name: 'Finance' });
      expect(JSON.stringify(data)).not.to.include('Secret');
    });
  });

  describe('get_tagging_rule', () => {
    test('returns the rule', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'get_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleA1 },
      });

      expect(isError).to.eql(false);
      expect(data.taggingRule).to.include({ id: ids.ruleA1, organizationId: ids.orgA });
    });

    test('an unknown rule and a rule of another organization are not found', async () => {
      const { callTool } = await setupMcpTest();

      for (const taggingRuleId of [ids.ruleB1, testId('tr', 'unknown')]) {
        const { isError, data } = await callTool({
          name: 'get_tagging_rule',
          args: { organizationId: ids.orgA, taggingRuleId },
        });

        expect(isError, taggingRuleId).to.eql(true);
        expect(data, taggingRuleId).to.eql(ruleNotFound);
      }
    });
  });

  describe('create_tagging_rule', () => {
    test('creates the rule and returns it with its conditions and tags', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'create_tagging_rule',
        args: { organizationId: ids.orgA, ...ruleBody() },
      });

      expect(isError).to.eql(false);
      expect(data.taggingRule).to.include({
        organizationId: ids.orgA,
        name: 'Travel docs',
        description: 'Tickets',
        enabled: false,
        conditionMatchMode: 'any',
      });
      expect(data.taggingRule.conditions).to.have.length(2);
      expect(data.taggingRule.actions.map(({ tag }: { tag: { id: string } }) => tag.id)).to.eql([
        ids.tagA2,
      ]);

      const { rules } = await getRuleRows({ db, taggingRuleId: data.taggingRule.id });
      expect(rules).to.have.length(1);
    });

    test('a rule without conditions is accepted', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'create_tagging_rule',
        args: { organizationId: ids.orgA, name: 'All', conditions: [], tagIds: [ids.tagA1] },
      });

      expect(isError).to.eql(false);
      expect(data.taggingRule.conditions).to.eql([]);
    });

    test('a tag of another organization is refused and nothing is created', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool({
        name: 'create_tagging_rule',
        args: { organizationId: ids.orgA, ...ruleBody({ tagIds: [ids.tagA1, ids.tagB1] }) },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(tagNotFound);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('an unknown tag is refused', async () => {
      const { callTool } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'create_tagging_rule',
        args: {
          organizationId: ids.orgA,
          ...ruleBody({ tagIds: [testId('tag', 'unknown')] }),
        },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(tagNotFound);
    });

    test('refuses invalid input', async () => {
      const { callTool } = await setupMcpTest();

      for (const overrides of [
        { name: '' },
        { name: 'a'.repeat(65) },
        { tagIds: [] },
        { conditionMatchMode: 'none' },
        { conditions: [{ field: 'name', operator: 'matches', value: 'x' }] },
        { conditions: [{ field: 'size', operator: 'equal', value: 'x' }] },
        { conditions: [{ field: 'name', operator: 'equal', value: '' }] },
        {
          conditions: Array.from({ length: 11 }, () => ({
            field: 'name',
            operator: 'equal',
            value: 'x',
          })),
        },
      ]) {
        const { isError, text } = await callTool({
          name: 'create_tagging_rule',
          args: { organizationId: ids.orgA, ...ruleBody(overrides) },
        });

        expect(isError, JSON.stringify(overrides)).to.eql(true);
        expect(text, JSON.stringify(overrides)).to.include('Invalid arguments');
      }
    });
  });

  describe('update_tagging_rule', () => {
    test('replaces the rule, its conditions and its tags', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'update_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleA1, ...ruleBody() },
      });

      expect(isError).to.eql(false);
      expect(data.taggingRule).to.include({
        id: ids.ruleA1,
        name: 'Travel docs',
        enabled: false,
        conditionMatchMode: 'any',
      });
      expect(data.taggingRule.conditions).to.have.length(2);

      const { conditions, actions } = await getRuleRows({ db, taggingRuleId: ids.ruleA1 });
      expect(conditions).to.have.length(2);
      expect(actions.map(({ tagId }) => tagId)).to.eql([ids.tagA2]);
    });

    test('calling it twice gives the same rule', async () => {
      const { callTool } = await setupMcpTest();
      const args = { organizationId: ids.orgA, taggingRuleId: ids.ruleA1, ...ruleBody() };

      const first = await callTool({ name: 'update_tagging_rule', args });
      const second = await callTool({ name: 'update_tagging_rule', args });

      const strip = ({ data }: { data: any }) => ({
        ...data.taggingRule,
        conditions: data.taggingRule.conditions.length,
        actions: data.taggingRule.actions.length,
        updatedAt: undefined,
      });
      expect(strip(second)).to.eql(strip(first));
    });

    test('a rule of another organization is not found and stays unchanged', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool({
        name: 'update_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleB1, ...ruleBody() },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(ruleNotFound);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });

    test('a tag of another organization is refused and the rule stays unchanged', async () => {
      const { callTool, db } = await setupMcpTest();
      const before = await snapshotDatabase({ db });

      const { isError, data } = await callTool({
        name: 'update_tagging_rule',
        args: {
          organizationId: ids.orgA,
          taggingRuleId: ids.ruleA1,
          ...ruleBody({ tagIds: [ids.tagB1] }),
        },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(tagNotFound);
      expect(await snapshotDatabase({ db })).to.eql(before);
    });
  });

  describe('delete_tagging_rule', () => {
    test('deletes the rule with its conditions and actions', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'delete_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleA1 },
      });

      expect(isError).to.eql(false);
      expect(data).to.eql({ deleted: true });
      expect(await getRuleRows({ db, taggingRuleId: ids.ruleA1 })).to.eql({
        rules: [],
        conditions: [],
        actions: [],
      });
      expect((await getRuleRows({ db, taggingRuleId: ids.ruleB1 })).rules).to.have.length(1);
    });

    test('a rule of another organization is not found and kept', async () => {
      const { callTool, db } = await setupMcpTest();

      const { isError, data } = await callTool({
        name: 'delete_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleB1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(ruleNotFound);
      expect((await getRuleRows({ db, taggingRuleId: ids.ruleB1 })).rules).to.have.length(1);
    });
  });

  describe('apply_tagging_rule', () => {
    async function setupApply() {
      const taskServices = createInMemoryTaskServices();
      const scheduleJob = vi
        .spyOn(taskServices, 'scheduleJob')
        .mockResolvedValue({ jobId: 'job_apply_1' } as never);
      const context = await setupMcpTest({ dependencies: { taskServices } });

      return { ...context, scheduleJob };
    }

    test('schedules the job and returns the task id', async () => {
      const { callTool, scheduleJob } = await setupApply();

      const { isError, data } = await callTool({
        name: 'apply_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleA1 },
      });

      expect(isError).to.eql(false);
      expect(data).to.eql({ taskId: 'job_apply_1' });
      expect(scheduleJob).toHaveBeenCalledExactlyOnceWith({
        taskName: 'apply-tagging-rule-to-documents',
        data: { organizationId: ids.orgA, taggingRuleId: ids.ruleA1 },
      });
    });

    test('a rule of another organization is not found and no job is scheduled', async () => {
      const { callTool, scheduleJob } = await setupApply();

      const { isError, data } = await callTool({
        name: 'apply_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleB1 },
      });

      expect(isError).to.eql(true);
      expect(data).to.eql(ruleNotFound);
      expect(scheduleJob).not.toHaveBeenCalled();
    });

    test('needs the permission to update documents as well, and schedules nothing without it', async () => {
      const { callTool, db, scheduleJob } = await setupApply();
      const { token } = await insertApiKey({
        db,
        userId: ids.alice,
        permissions: API_KEY_PERMISSIONS_VALUES.filter((p) => p !== 'documents:update'),
      });

      const { isError, text } = await callTool({
        name: 'apply_tagging_rule',
        args: { organizationId: ids.orgA, taggingRuleId: ids.ruleA1 },
        token,
      });

      expect(isError).to.eql(true);
      expect(text).to.include('documents:update');
      expect(scheduleJob).not.toHaveBeenCalled();
    });
  });
});
