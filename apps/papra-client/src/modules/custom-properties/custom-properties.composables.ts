import type { CustomPropertyDisplayLabels } from './custom-property-display.models';
import { useI18n } from '@/modules/i18n/i18n.provider';

export function useCustomPropertyDisplayLabels() {
  const { t, formatDate } = useI18n();

  return (): CustomPropertyDisplayLabels => ({
    yes: t('documents.custom-properties.boolean-true'),
    no: t('documents.custom-properties.boolean-false'),
    formatDate: (date) => formatDate(date, { dateStyle: 'medium' }),
  });
}
