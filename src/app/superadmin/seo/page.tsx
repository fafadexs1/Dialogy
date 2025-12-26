import { seoStore } from '@/services/seo-store';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/table';
import { Plus, Search, Edit, Trash } from 'lucide-react';

export const metadata: Metadata = {
    title: 'SEO Management | Superadmin',
};

// Force dynamic because we read from local filesystem which might change
export const dynamic = 'force-dynamic';

export default async function SeoListPage() {
    const entries = await seoStore.list();

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">SEO Manager</h1>
                    <p className="text-muted-foreground mt-2">
                        Manage meta tags and Open Graph data for your pages.
                    </p>
                </div>

                <div className="flex justify-between items-center mb-6">
                    <div className="relative w-full max-w-sm">
                        {/* Search placeholder if needed */}
                    </div>
                    <div className="flex gap-2">
                        <Link href="/superadmin/seo/settings">
                            <Button variant="outline">Global Settings</Button>
                        </Link>
                        <Link href="/superadmin/seo/new">
                            <Button>
                                <Plus className="mr-2 h-4 w-4" />
                                Create Entry
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>

            <div className="border rounded-lg bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Pathname</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Last Updated</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {entries.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No SEO entries found. Create one to get started.
                                </TableCell>
                            </TableRow>
                        ) : (
                            entries.map((entry) => (
                                <TableRow key={entry.id}>
                                    <TableCell className="font-mono text-sm">{entry.pathname}</TableCell>
                                    <TableCell className="max-w-[300px] truncate" title={entry.title}>
                                        {entry.title || <span className="text-muted-foreground italic">Default</span>}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={entry.robots.includes('noindex') ? 'destructive' : 'default'}>
                                            {entry.robots.includes('noindex') ? 'NoIndex' : 'Indexable'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {new Date(entry.updatedAt).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Link href={`/superadmin/seo/${entry.id}`}>
                                            <Button variant="ghost" size="sm">
                                                <Edit className="w-4 h-4 mr-2" />
                                                Edit
                                            </Button>
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
