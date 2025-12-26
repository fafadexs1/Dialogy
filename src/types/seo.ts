import { z } from 'zod';

export const ROBOTS_OPTIONS = ['index, follow', 'noindex, nofollow', 'index, nofollow', 'noindex, follow'] as const;

export const SeoEntrySchema = z.object({
    id: z.string().min(1, "ID is required"), // Stable ID for editing
    pathname: z.string().min(1, "Pathname is required").startsWith("/", "Pathname must start with /"),
    title: z
        .string()
        .min(1, "Title is required")
        .max(60, "Title should be under 60 characters for best SEO results")
        .optional(),
    description: z
        .string()
        .max(160, "Description should be under 160 characters")
        .optional(),
    canonical: z.string().url("Canonical must be a valid URL").optional().or(z.literal("")),
    robots: z.enum(ROBOTS_OPTIONS).default('index, follow'),
    ogImage: z.string().url("OG Image must be a valid URL").optional().or(z.literal("")),
    ogType: z.enum(['website', 'article', 'profile']).default('website'),
    jsonLd: z.string().optional(), // Stringified JSON
    updatedAt: z.string(),
});

export type SeoEntry = z.infer<typeof SeoEntrySchema>;

export const CreateSeoEntrySchema = SeoEntrySchema.omit({ id: true, updatedAt: true }).extend({
    // pathname is required on creation
});

export const UpdateSeoEntrySchema = SeoEntrySchema.partial().required({ id: true });
