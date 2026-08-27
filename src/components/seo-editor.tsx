'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { createSeoEntry, updateSeoEntry, deleteSeoEntry } from '@/actions/seo';
import { SeoEntrySchema, SeoEntry, ROBOTS_OPTIONS } from '@/types/seo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Props = {
    initialData?: SeoEntry;
    isNew: boolean;
};

export default function SeoEditor({ initialData, isNew }: Props) {
    const router = useRouter();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('edit');

    const defaultValues: z.input<typeof SeoEntrySchema> = initialData || {
        id: 'new', // will be ignored/generated on server for new
        pathname: '',
        title: '',
        description: '',
        canonical: '',
        robots: 'index, follow',
        ogImage: '',
        ogType: 'website',
        jsonLd: '',
        updatedAt: new Date().toISOString(),
    };

    const form = useForm<z.input<typeof SeoEntrySchema>, any, SeoEntry>({
        resolver: zodResolver(SeoEntrySchema),
        defaultValues,
    });

    const { register, watch, setValue, handleSubmit, formState: { errors, isSubmitting } } = form;

    const watched = watch();

    const onSubmit = async (data: SeoEntry) => {
        try {
            if (isNew) {
                // Remove ID from payload for creation as schema expects
                const { id, ...createPayload } = data;
                const res = await createSeoEntry(createPayload);

                if (res?.error) throw new Error(JSON.stringify(res.error));
                toast({ title: 'Success', description: 'Entry created!' });
                router.push('/superadmin/seo');
            } else {
                const res = await updateSeoEntry(data);
                if (res?.error) throw new Error(JSON.stringify(res.error));
                toast({ title: 'Success', description: 'Entry updated!' });
            }
            router.refresh();
        } catch (e: any) {
            toast({ title: 'Error', description: 'Error saving: ' + e.message, variant: 'destructive' });
        }
    };

    const handleDelete = async () => {
        if (!confirm('Are you sure?')) return;
        await deleteSeoEntry(initialData!.id);
        toast({ title: 'Success', description: 'Deleted!' });
        router.push('/superadmin/seo');
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-8 items-start pb-20">
            {/* Editor Column */}
            <div className="space-y-6">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label>ID (Stable identifier)</Label>
                                <Input {...register('id')} disabled={!isNew} placeholder="e.g. landing-page" />
                                {errors.id && <p className="text-red-500 text-sm">{errors.id.message}</p>}
                            </div>

                            <div className="grid gap-2">
                                <Label>Pathname</Label>
                                <Input {...register('pathname')} placeholder="/about" />
                                {errors.pathname && <p className="text-red-500 text-sm">{errors.pathname.message}</p>}
                            </div>

                            <div className="grid gap-2">
                                <Label>Title ({(watched.title?.length || 0)}/60)</Label>
                                <Input {...register('title')} />
                                {watched.title && watched.title.length > 60 && <p className="text-amber-500 text-sm">Title is too long!</p>}
                            </div>

                            <div className="grid gap-2">
                                <Label>Description ({(watched.description?.length || 0)}/160)</Label>
                                <Textarea {...register('description')} />
                                {watched.description && watched.description.length > 160 && <p className="text-amber-500 text-sm">Description is too long!</p>}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader><CardTitle>Advanced</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label>Robots</Label>
                                <Select
                                    onValueChange={(val) => setValue('robots', val as any)}
                                    defaultValue={watched.robots}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ROBOTS_OPTIONS.map(opt => (
                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid gap-2">
                                <Label>Canonical URL</Label>
                                <Input {...register('canonical')} placeholder="https://..." />
                            </div>

                            <div className="grid gap-2">
                                <Label>OG Image URL</Label>
                                <Input {...register('ogImage')} placeholder="https://..." />
                            </div>

                            <div className="grid gap-2">
                                <Label>JSON-LD (Structured Data)</Label>
                                <Textarea {...register('jsonLd')} className="font-mono text-xs h-32" placeholder='{"@context": "https://schema.org", ...}' />
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex gap-4">
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Saving...' : 'Save Changes'}
                        </Button>
                        {!isNew && (
                            <Button type="button" variant="destructive" onClick={handleDelete}>Delete</Button>
                        )}
                    </div>
                </form>
            </div>

            {/* Preview Column */}
            <div className="sticky top-8 space-y-8">
                <h2 className="text-2xl font-bold">Live Preview</h2>

                {/* Google Snippet */}
                <div className="bg-white p-4 rounded shadow border max-w-[600px]">
                    <div className="text-xs text-gray-500 mb-1">Google Search Result</div>
                    <div className="flex items-center gap-2 text-sm text-[#202124] mb-1">
                        <div className="bg-gray-100 rounded-full w-6 h-6 flex items-center justify-center text-xs">🌐</div>
                        <div className="flex flex-col">
                            <span className="text-[#202124] text-xs">example.com</span>
                            <span className="text-[#5f6368] text-xs px-0">{watched.pathname}</span>
                        </div>
                    </div>
                    <div className="text-[#1a0dab] text-xl cursor-pointer hover:underline truncate">
                        {watched.title || 'Page Title'}
                    </div>
                    <div className="text-[#4d5156] text-sm break-words line-clamp-2">
                        {watched.description || 'Page description will appear here...'}
                    </div>
                </div>

                {/* OG Card (Facebook/LinkedIn/Slack) */}
                <div className="bg-[#f0f2f5] p-4 rounded border max-w-[500px]">
                    <div className="text-xs text-gray-500 mb-2">Social Share (Open Graph)</div>
                    <div className="bg-white border rounded overflow-hidden">
                        <div className="aspect-[1.91/1] bg-gray-200 w-full relative">
                            {watched.ogImage ? (
                                <img src={watched.ogImage} alt="OG" className="w-full h-full object-cover" />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-gray-400">No Image</div>
                            )}
                        </div>
                        <div className="p-3 bg-[#f2f3f5] border-t">
                            <div className="uppercase text-[10px] text-gray-500 tracking-wide mb-0.5">EXAMPLE.COM</div>
                            <div className="font-bold text-[#1d2129] mb-1 line-clamp-1">
                                {watched.title || 'Page Title'}
                            </div>
                            <div className="text-xs text-[#606770] line-clamp-2">
                                {watched.description || 'Description...'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
