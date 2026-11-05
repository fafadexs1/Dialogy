export type WorkspaceGif = {id:string; name:string; url:string; sound:'none'|'pum'|'applause'|'party'|'coffee'};
/** Accept direct HTTPS GIFs on public domain names; never embed local network hosts. */
export function isSafeGifUrl(input: unknown): input is string {
  if (typeof input !== 'string' || input.length > 2048) return false;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const publicDomain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      && !/(?:^|\.)(?:localhost|local|internal|home|lan|test|example|invalid)$/.test(host);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && publicDomain && /\.gif$/i.test(url.pathname);
  } catch { return false; }
}

/** Give each playback a distinct resource so it starts at the first frame. */
export function gifPlaybackUrl(url:string,reactionId:string):string {
 if(!isSafeGifUrl(url)) return '';
 const result=new URL(url);
 result.searchParams.set('_dialogy_playback',reactionId);
 return result.toString();
}
