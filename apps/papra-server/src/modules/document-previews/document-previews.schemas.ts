import * as v from 'valibot';
import { PREVIEW_VARIANTS } from './document-previews.constants';

export const documentPreviewVariantSchema = v.picklist(PREVIEW_VARIANTS);
