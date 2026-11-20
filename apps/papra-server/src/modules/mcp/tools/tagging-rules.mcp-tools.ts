import * as v from 'valibot';
import { organizationIdSchema } from '../../organizations/organization.schemas';
import { createTagsRepository } from '../../tags/tags.repository';
import {
  CONDITION_MATCH_MODES,
  TAGGING_RULE_FIELDS,
  TAGGING_RULE_OPERATORS,
} from '../../tagging-rules/tagging-rules.constants';
import { createTaggingRuleNotFoundError } from '../../tagging-rules/tagging-rules.errors';
import { createTaggingRulesRepository } from '../../tagging-rules/tagging-rules.repository';
import {
  taggingRuleBodySchema,
  taggingRuleIdSchema,
} from '../../tagging-rules/tagging-rules.schemas';
import {
  createTaggingRule,
  ensureTagsBelongToOrganization,
} from '../../tagging-rules/tagging-rules.usecases';
import {
  ADDITIVE_ANNOTATIONS,
  defineMcpTool,
  DESTRUCTIVE_ANNOTATIONS,
  IDEMPOTENT_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../mcp.tools.types';
import type { McpToolDependencies } from '../mcp.tools.types';

const organizationParams = { organizationId: organizationIdSchema };
const ruleParams = { ...organizationParams, taggingRuleId: taggingRuleIdSchema };

// The input of a tool is the params and the JSON body of the REST route in one flat object
const createTaggingRuleInput = v.strictObject({
  ...organizationParams,
  ...taggingRuleBodySchema.entries,
});
const updateTaggingRuleInput = v.strictObject({
  ...ruleParams,
  ...taggingRuleBodySchema.entries,
});

const fields = Object.values(TAGGING_RULE_FIELDS).join(', ');
const operators = Object.values(TAGGING_RULE_OPERATORS).join(', ');
const matchModes = Object.values(CONDITION_MATCH_MODES).join(' or ');

const RULE_FORMAT = `A rule has a name, an optional description, an enabled flag, a conditionMatchMode (${matchModes}, default ${CONDITION_MATCH_MODES.ALL}), up to 10 conditions and the tagIds to add when it matches. A condition is {field, operator, value}: field is one of ${fields}, operator is one of ${operators}, comparisons ignore case. A rule without conditions matches every document. tagIds must be ids of existing tags of the same organization (see list_tags), at least one.`;

async function getTaggingRuleOrThrow({
  organizationId,
  taggingRuleId,
  deps,
}: {
  organizationId: string;
  taggingRuleId: string;
  deps: McpToolDependencies;
}) {
  const taggingRulesRepository = createTaggingRulesRepository({ db: deps.db });
  const { taggingRule } = await taggingRulesRepository.getOrganizationTaggingRule({
    organizationId,
    taggingRuleId,
  });

  // Scoped by organization: a rule of another organization is reported as not found
  if (!taggingRule) {
    throw createTaggingRuleNotFoundError();
  }

  return { taggingRule };
}

export const listTaggingRulesTool = defineMcpTool({
  name: 'list_tagging_rules',
  description: `List the tagging rules of an organization with their conditions and the tags they add. A tagging rule adds tags automatically to new documents that match its conditions. ${RULE_FORMAT}`,
  input: v.strictObject(organizationParams),
  permissions: ['tagging-rules:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId }, deps }) => {
    const taggingRulesRepository = createTaggingRulesRepository({ db: deps.db });
    const { taggingRules } = await taggingRulesRepository.getOrganizationTaggingRules({
      organizationId,
    });

    return { taggingRules };
  },
});

export const getTaggingRuleTool = defineMcpTool({
  name: 'get_tagging_rule',
  description:
    'Return one tagging rule with its conditions and the tags it adds. Use list_tagging_rules for rule ids.',
  input: v.strictObject(ruleParams),
  permissions: ['tagging-rules:read'],
  annotations: READ_ONLY_ANNOTATIONS,
  handler: async ({ input: { organizationId, taggingRuleId }, deps }) =>
    getTaggingRuleOrThrow({ organizationId, taggingRuleId, deps }),
});

export const createTaggingRuleTool = defineMcpTool({
  name: 'create_tagging_rule',
  description: `Create a tagging rule. It applies to documents added from now on; use apply_tagging_rule to also tag existing documents. ${RULE_FORMAT} Returns the created rule.`,
  input: createTaggingRuleInput,
  permissions: ['tagging-rules:create'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({
    input: { organizationId, name, description, enabled, conditionMatchMode, conditions, tagIds },
    deps,
  }) => {
    const { tagIds: uniqueTagIds } = await ensureTagsBelongToOrganization({
      tagIds,
      organizationId,
      tagsRepository: createTagsRepository({ db: deps.db }),
    });

    const taggingRulesRepository = createTaggingRulesRepository({ db: deps.db });

    const {
      taggingRule: { id: taggingRuleId },
    } = await createTaggingRule({
      name,
      description,
      enabled,
      conditionMatchMode,
      conditions,
      tagIds: uniqueTagIds,
      organizationId,
      taggingRulesRepository,
    });

    return getTaggingRuleOrThrow({ organizationId, taggingRuleId, deps });
  },
});

export const updateTaggingRuleTool = defineMcpTool({
  name: 'update_tagging_rule',
  description: `Replace a tagging rule. Like a full update, the conditions and tags you send replace the existing ones, so send the complete rule (use get_tagging_rule first to start from the current one); an omitted description, enabled or conditionMatchMode keeps its current value. ${RULE_FORMAT} Returns the updated rule.`,
  input: updateTaggingRuleInput,
  permissions: ['tagging-rules:update'],
  annotations: IDEMPOTENT_ANNOTATIONS,
  handler: async ({
    input: {
      organizationId,
      taggingRuleId,
      name,
      description,
      enabled,
      conditionMatchMode,
      conditions,
      tagIds,
    },
    deps,
  }) => {
    await getTaggingRuleOrThrow({ organizationId, taggingRuleId, deps });
    const { tagIds: uniqueTagIds } = await ensureTagsBelongToOrganization({
      tagIds,
      organizationId,
      tagsRepository: createTagsRepository({ db: deps.db }),
    });

    const taggingRulesRepository = createTaggingRulesRepository({ db: deps.db });

    await taggingRulesRepository.updateOrganizationTaggingRule({
      organizationId,
      taggingRuleId,
      taggingRule: {
        name,
        description,
        enabled,
        conditionMatchMode,
        conditions,
        tagIds: uniqueTagIds,
      },
    });

    return getTaggingRuleOrThrow({ organizationId, taggingRuleId, deps });
  },
});

export const deleteTaggingRuleTool = defineMcpTool({
  name: 'delete_tagging_rule',
  description:
    'Delete a tagging rule. Tags it already added to documents are kept. This cannot be undone.',
  input: v.strictObject(ruleParams),
  permissions: ['tagging-rules:delete'],
  annotations: DESTRUCTIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, taggingRuleId }, deps }) => {
    await getTaggingRuleOrThrow({ organizationId, taggingRuleId, deps });

    const taggingRulesRepository = createTaggingRulesRepository({ db: deps.db });
    await taggingRulesRepository.deleteOrganizationTaggingRule({ organizationId, taggingRuleId });

    return { deleted: true };
  },
});

export const applyTaggingRuleTool = defineMcpTool({
  name: 'apply_tagging_rule',
  description:
    'Apply a tagging rule to all the existing documents of the organization: the documents matching its conditions get its tags, nothing is ever removed. It runs in the background and there is no status tool: call search_documents or get_document a little later to see the tags. Returns the id of the scheduled task.',
  input: v.strictObject(ruleParams),
  // It adds tags to documents, so the key needs the document write permission on top of the rule
  permissions: ['tagging-rules:read', 'documents:update'],
  annotations: ADDITIVE_ANNOTATIONS,
  handler: async ({ input: { organizationId, taggingRuleId }, deps }) => {
    await getTaggingRuleOrThrow({ organizationId, taggingRuleId, deps });

    const { jobId: taskId } = await deps.taskServices.scheduleJob({
      taskName: 'apply-tagging-rule-to-documents',
      data: { organizationId, taggingRuleId },
    });

    return { taskId };
  },
});
