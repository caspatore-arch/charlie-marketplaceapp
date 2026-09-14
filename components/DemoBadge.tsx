/**
 * Thin convenience wrapper around <Badge kind="demo" /> that renders nothing
 * when `visible` is false, so call sites can write `<DemoBadge visible={x.isDemo} />`
 * without an extra conditional.
 */
import React from 'react';
import { Badge } from './ui/Badge';

export function DemoBadge({ visible = true }: { visible?: boolean }) {
  if (!visible) return null;
  return <Badge kind="demo" />;
}

export default DemoBadge;
