/**
 * Real, documented web share intents. Every parameter is URL-encoded.
 * Instagram and Snapchat are deliberately absent: neither has a web intent
 * that can prefill a post, story or DM, so they go through the OS share sheet
 * or "copy link" instead (see ShareRow).
 */
export type IntentTarget = 'x' | 'facebook' | 'whatsapp' | 'reddit' | 'telegram' | 'sms' | 'email';

export interface ShareContent {
  title: string;
  /** One-line description of the item, e.g. "Desk lamp for $15 on Dibbs". */
  text: string;
  url: string;
}

const enc = encodeURIComponent;

export function buildIntentUrl(target: IntentTarget, c: ShareContent): string {
  switch (target) {
    case 'x':
      return `https://twitter.com/intent/tweet?text=${enc(c.text)}&url=${enc(c.url)}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${enc(c.url)}`;
    case 'whatsapp':
      return `https://wa.me/?text=${enc(`${c.text} ${c.url}`)}`;
    case 'reddit':
      return `https://www.reddit.com/submit?url=${enc(c.url)}&title=${enc(c.title)}`;
    case 'telegram':
      return `https://t.me/share/url?url=${enc(c.url)}&text=${enc(c.text)}`;
    case 'sms':
      return `sms:?body=${enc(`${c.text} ${c.url}`)}`;
    case 'email':
      return `mailto:?subject=${enc(c.title)}&body=${enc(`${c.text}\n\n${c.url}`)}`;
  }
}
