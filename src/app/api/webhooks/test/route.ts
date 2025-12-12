'use server';
import { NextResponse } from 'next/server';

export async function POST() {
    return NextResponse.json({ message: 'Webhooks folder works' });
}
