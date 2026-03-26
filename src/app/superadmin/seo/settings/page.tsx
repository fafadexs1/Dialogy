'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToast } from '@/hooks/use-toast';
import { getGlobalSeoSettings, updateGlobalSeoSettings } from '@/actions/seo-global';
import { GlobalSeoSchema, GlobalSeoSettings } from '@/types/seo-global';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';

export default function GlobalSeoSettingsPage() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);

    const form = useForm<GlobalSeoSettings>({
        resolver: zodResolver(GlobalSeoSchema),
        defaultValues: {
            siteName: '',
            slogan: '',
            titleTemplate: '%s | Site',
            description: '',
            faviconUrl: '',
            logoUrl: '',
            defaultOgImage: '',
            twitterHandle: '',
            themeColor: '#ffffff',
        }
    });

    const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form;

    useEffect(() => {
        getGlobalSeoSettings()
            .then(data => {
                console.log('[SettingsPage] Loaded data:', data);
                reset(data);
            })
            .catch(err => console.error('[SettingsPage] Error loading:', err))
            .finally(() => setLoading(false));
    }, [reset]);

    const onSubmit = async (data: GlobalSeoSettings) => {
        try {
            await updateGlobalSeoSettings(data);
            toast({ title: 'Success', description: 'Global settings updated!' });
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    };

    if (loading) return <div className="p-8">Loading settings...</div>;

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/superadmin/seo">
                    <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Global SEO Settings</h1>
                    <p className="text-muted-foreground">Configure site-wide defaults like favicon, slogan, and branding.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Branding & Identity</CardTitle>
                        <CardDescription>These settings apply to the whole site.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-2">
                            <Label>Site Name</Label>
                            <Input {...register('siteName')} placeholder="Dialogy" />
                            {errors.siteName && <p className="text-red-500 text-sm">{errors.siteName.message}</p>}
                        </div>

                        <div className="grid gap-2">
                            <Label>Slogan / Tagline</Label>
                            <Input {...register('slogan')} placeholder="IA Conversacional para Empresas" />
                            <p className="text-xs text-muted-foreground">Often used in the default title or description.</p>
                        </div>

                        <div className="grid gap-2">
                            <Label>Title Template</Label>
                            <Input {...register('titleTemplate')} placeholder="%s | Dialogy" />
                            <p className="text-xs text-muted-foreground">%s will be replaced by the page title.</p>
                        </div>

                        <div className="grid gap-2">
                            <Label>Default Description</Label>
                            <Input {...register('description')} placeholder="Default site description..." />
                        </div>

                        <div className="grid gap-2">
                            <Label>Logo URL</Label>
                            <Input {...register('logoUrl')} placeholder="/logo.png" />
                        </div>

                        <div className="grid gap-2">
                            <Label>Default Open Graph Image</Label>
                            <Input {...register('defaultOgImage')} placeholder="/logo-new.jpg" />
                        </div>

                        <div className="grid gap-2">
                            <Label>Twitter Handle</Label>
                            <Input {...register('twitterHandle')} placeholder="@dialogy" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Assets & Theme</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-2">
                            <Label>Favicon</Label>
                            <div className="flex items-center gap-4">
                                {form.watch('faviconUrl') && (
                                    <div className="w-12 h-12 border rounded bg-gray-100 flex items-center justify-center overflow-hidden">
                                        <img src={form.watch('faviconUrl')} alt="Favicon" className="w-8 h-8 object-contain" />
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <input type="hidden" {...register('faviconUrl')} />
                                    <Input
                                        type="file"
                                        accept=".ico,.png,.jpg,.jpeg,.svg"
                                        onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;

                                            const formData = new FormData();
                                            formData.append('file', file);

                                            try {
                                                const { uploadFavicon } = await import('@/actions/upload');
                                                const res = await uploadFavicon(formData);
                                                if (res.success) {
                                                    console.log('[SEO] New favicon URL:', res.url);
                                                    form.setValue('faviconUrl', res.url, {
                                                        shouldValidate: true,
                                                        shouldDirty: true,
                                                        shouldTouch: true
                                                    });
                                                    toast({ title: "Uploaded", description: "Favicon uploaded successfully" });
                                                }
                                            } catch (err: any) {
                                                toast({ title: "Error", description: err.message, variant: 'destructive' });
                                            }
                                        }}
                                    />
                                    {errors.faviconUrl && (
                                        <p className="text-red-500 text-sm">{errors.faviconUrl.message}</p>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Upload an image.</p>
                        </div>

                        <div className="grid gap-2">
                            <Label>Theme Color (Hex)</Label>
                            <div className="flex gap-2">
                                <Input type="color" className="w-12 p-1 cursor-pointer" {...register('themeColor')} />
                                <Input {...register('themeColor')} placeholder="#ffffff" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="flex justify-end">
                    <Button type="submit" disabled={isSubmitting} className="min-w-[150px]">
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                    </Button>
                </div>
            </form>
        </div>
    );
}
