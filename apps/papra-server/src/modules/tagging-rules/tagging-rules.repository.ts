import type { Database } from '../app/database/database.types';
import type {
  ConditionMatchMode,
  DbInsertableTaggingRule,
  TaggingRuleField,
  TaggingRuleOperator,
} from './tagging-rules.types';
import { injectArguments, safely } from '@corentinth/chisels';
import { and, eq } from 'drizzle-orm';
import { createError } from '../shared/errors/errors';
import { omitUndefined } from '../shared/objects';
import { generateId } from '../shared/random/ids';
import { tagsTable } from '../tags/tags.table';
import { aggregateTaggingRules } from './tagging-rules.repository.models';
import { TAGGING_RULE_ID_PREFIX } from './tagging-rules.constants';
import {
  taggingRuleActionsTable,
  taggingRuleConditionsTable,
  taggingRulesTable,
} from './tagging-rules.tables';

export type TaggingRulesRepository = ReturnType<typeof createTaggingRulesRepository>;

export function createTaggingRulesRepository({ db }: { db: Database }) {
  return injectArguments(
    {
      getOrganizationTaggingRules,
      getOrganizationEnabledTaggingRules,
      getOrganizationTaggingRule,
      createTaggingRule,
      createTaggingRuleWithRelations,
      deleteOrganizationTaggingRule,
      updateOrganizationTaggingRule,
      createTaggingRuleConditions,
      createTaggingRuleActions,
    },
    { db },
  );
}

async function getOrganizationTaggingRules({
  organizationId,
  db,
}: {
  organizationId: string;
  db: Database;
}) {
  const rawTaggingRules = await db
    .select()
    .from(taggingRulesTable)
    .where(eq(taggingRulesTable.organizationId, organizationId))
    .leftJoin(
      taggingRuleConditionsTable,
      eq(taggingRulesTable.id, taggingRuleConditionsTable.taggingRuleId),
    )
    .leftJoin(
      taggingRuleActionsTable,
      eq(taggingRulesTable.id, taggingRuleActionsTable.taggingRuleId),
    )
    .leftJoin(
      tagsTable,
      and(
        eq(taggingRuleActionsTable.tagId, tagsTable.id),
        eq(tagsTable.organizationId, taggingRulesTable.organizationId),
      ),
    );

  return aggregateTaggingRules({ rawTaggingRules });
}

async function getOrganizationTaggingRule({
  organizationId,
  taggingRuleId,
  db,
}: {
  organizationId: string;
  taggingRuleId: string;
  db: Database;
}) {
  const rawTaggingRules = await db
    .select()
    .from(taggingRulesTable)
    .where(
      and(
        eq(taggingRulesTable.id, taggingRuleId),
        eq(taggingRulesTable.organizationId, organizationId),
      ),
    )
    .leftJoin(
      taggingRuleConditionsTable,
      eq(taggingRulesTable.id, taggingRuleConditionsTable.taggingRuleId),
    )
    .leftJoin(
      taggingRuleActionsTable,
      eq(taggingRulesTable.id, taggingRuleActionsTable.taggingRuleId),
    )
    .leftJoin(
      tagsTable,
      and(
        eq(taggingRuleActionsTable.tagId, tagsTable.id),
        eq(tagsTable.organizationId, taggingRulesTable.organizationId),
      ),
    );

  // oxlint-disable-next-line typescript/no-useless-default-assignment -- defensive fallback for empty result set
  const { taggingRules = [] } = aggregateTaggingRules({ rawTaggingRules });
  const [taggingRule] = taggingRules;

  return {
    taggingRule,
  };
}

async function getOrganizationEnabledTaggingRules({
  organizationId,
  db,
}: {
  organizationId: string;
  db: Database;
}) {
  const rawTaggingRules = await db
    .select()
    .from(taggingRulesTable)
    .where(
      and(
        eq(taggingRulesTable.organizationId, organizationId),
        eq(taggingRulesTable.enabled, true),
      ),
    )
    .leftJoin(
      taggingRuleConditionsTable,
      eq(taggingRulesTable.id, taggingRuleConditionsTable.taggingRuleId),
    )
    .leftJoin(
      taggingRuleActionsTable,
      eq(taggingRulesTable.id, taggingRuleActionsTable.taggingRuleId),
    )
    .leftJoin(
      tagsTable,
      and(
        eq(taggingRuleActionsTable.tagId, tagsTable.id),
        eq(tagsTable.organizationId, taggingRulesTable.organizationId),
      ),
    );

  return aggregateTaggingRules({ rawTaggingRules });
}

async function createTaggingRule({
  taggingRule,
  db,
}: {
  taggingRule: DbInsertableTaggingRule;
  db: Database;
}) {
  const [createdTaggingRule] = await db.insert(taggingRulesTable).values(taggingRule).returning();

  if (!createdTaggingRule) {
    // Very unlikely to happen as the query will throw an error if the tagging rule is not created
    // it's for type safety
    throw new Error('Failed to create tagging rule');
  }

  return { taggingRule: createdTaggingRule };
}

// Rule, conditions and actions are inserted in one batch (one transaction): no half created rule.
// The id is generated here so the children can reference it within the same batch.
async function createTaggingRuleWithRelations({
  taggingRule,
  conditions,
  tagIds,
  db,
}: {
  taggingRule: DbInsertableTaggingRule;
  conditions: { field: TaggingRuleField; operator: TaggingRuleOperator; value: string }[];
  tagIds: string[];
  db: Database;
}) {
  const taggingRuleId = taggingRule.id ?? generateId({ prefix: TAGGING_RULE_ID_PREFIX });

  const [insertedTaggingRules] = await db.batch([
    db
      .insert(taggingRulesTable)
      .values({ ...taggingRule, id: taggingRuleId })
      .returning(),
    ...(conditions.length > 0
      ? [
          db
            .insert(taggingRuleConditionsTable)
            .values(conditions.map((condition) => ({ ...condition, taggingRuleId }))),
        ]
      : []),
    db.insert(taggingRuleActionsTable).values(tagIds.map((tagId) => ({ taggingRuleId, tagId }))),
  ]);

  const [createdTaggingRule] = insertedTaggingRules;

  if (!createdTaggingRule) {
    throw new Error('Failed to create tagging rule');
  }

  return { taggingRule: createdTaggingRule };
}

async function deleteOrganizationTaggingRule({
  organizationId,
  taggingRuleId,
  db,
}: {
  organizationId: string;
  taggingRuleId: string;
  db: Database;
}) {
  await db
    .delete(taggingRulesTable)
    .where(
      and(
        eq(taggingRulesTable.id, taggingRuleId),
        eq(taggingRulesTable.organizationId, organizationId),
      ),
    );
}

async function updateOrganizationTaggingRule({
  organizationId,
  taggingRuleId,
  taggingRule,
  db,
}: {
  organizationId: string;
  taggingRuleId: string;
  taggingRule: {
    name: string;
    description: string | undefined;
    enabled: boolean | undefined;
    conditionMatchMode: ConditionMatchMode | undefined;
    conditions: { field: TaggingRuleField; operator: TaggingRuleOperator; value: string }[];
    tagIds: string[];
  };
  db: Database;
}) {
  const { name, description, enabled, conditionMatchMode, conditions, tagIds } = taggingRule;

  // The rule must belong to the organization before any of its conditions or actions is touched
  const [existingTaggingRule] = await db
    .select({ id: taggingRulesTable.id })
    .from(taggingRulesTable)
    .where(
      and(
        eq(taggingRulesTable.id, taggingRuleId),
        eq(taggingRulesTable.organizationId, organizationId),
      ),
    );

  if (!existingTaggingRule) {
    throw createError({
      statusCode: 404,
      message: 'Tagging rule not found',
      code: 'tagging-rules.not-found',
    });
  }

  // db.batch runs the statements in one transaction on a single connection (and, unlike
  // db.transaction, works with the in-memory test database). Conditions and actions are recreated.
  const statements = [
    db
      .update(taggingRulesTable)
      .set(omitUndefined({ name, description, enabled, conditionMatchMode }))
      .where(
        and(
          eq(taggingRulesTable.id, taggingRuleId),
          eq(taggingRulesTable.organizationId, organizationId),
        ),
      ),
    db
      .delete(taggingRuleConditionsTable)
      .where(eq(taggingRuleConditionsTable.taggingRuleId, taggingRuleId)),
    ...(conditions.length > 0
      ? [
          db
            .insert(taggingRuleConditionsTable)
            .values(conditions.map((condition) => ({ ...condition, taggingRuleId }))),
        ]
      : []),
    db
      .delete(taggingRuleActionsTable)
      .where(eq(taggingRuleActionsTable.taggingRuleId, taggingRuleId)),
    db.insert(taggingRuleActionsTable).values(tagIds.map((tagId) => ({ taggingRuleId, tagId }))),
  ] as const;

  const [, error] = await safely(async () => db.batch(statements));

  if (error) {
    // The rule can disappear between the check and the batch, the foreign keys then reject the inserts
    const [stillExists] = await db
      .select({ id: taggingRulesTable.id })
      .from(taggingRulesTable)
      .where(eq(taggingRulesTable.id, taggingRuleId));

    if (!stillExists) {
      throw createError({
        statusCode: 404,
        message: 'Tagging rule not found',
        code: 'tagging-rules.not-found',
      });
    }

    throw error;
  }
}

async function createTaggingRuleConditions({
  taggingRuleId,
  conditions,
  db,
}: {
  taggingRuleId: string;
  conditions: {
    field: TaggingRuleField;
    operator: TaggingRuleOperator;
    value: string;
  }[];
  db: Database;
}) {
  await db
    .insert(taggingRuleConditionsTable)
    .values(conditions.map((condition) => ({ ...condition, taggingRuleId })));
}

async function createTaggingRuleActions({
  taggingRuleId,
  tagIds,
  db,
}: {
  taggingRuleId: string;
  tagIds: string[];
  db: Database;
}) {
  await db
    .insert(taggingRuleActionsTable)
    .values(tagIds.map((tagId) => ({ taggingRuleId, tagId })));
}
