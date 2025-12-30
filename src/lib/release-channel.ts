import 'server-only';

import { cookies, headers } from 'next/headers';

export const RELEASE_CHANNEL_HEADER = 'x-release-channel';
export const RELEASE_CHANNEL_COOKIE =
  process.env.RELEASE_CHANNEL_COOKIE || 'dialogy_release_channel';

const DEFAULT_RELEASE_CHANNEL = process.env.APP_RELEASE_CHANNEL || 'stable';

export async function getReleaseChannel(): Promise<string> {
  try {
    const headerStore = await headers();
    const headerChannel = headerStore.get(RELEASE_CHANNEL_HEADER);
    if (headerChannel) {
      return headerChannel;
    }
  } catch {
    // noop
  }

  try {
    const cookieStore = await cookies();
    const cookieChannel = cookieStore.get(RELEASE_CHANNEL_COOKIE)?.value;
    if (cookieChannel) {
      return cookieChannel;
    }
  } catch {
    // noop
  }

  return DEFAULT_RELEASE_CHANNEL;
}
