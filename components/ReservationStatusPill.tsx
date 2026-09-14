/**
 * Usage: <ReservationStatusPill status={reservation.status} />
 */
import React from 'react';
import { Badge, type BadgeTone } from './ui/Badge';
import type { ReservationStatus } from '@/types';

const STATUS_LABEL: Record<ReservationStatus, string> = {
  requested: 'Requested',
  countered: 'Countered',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
  completed: 'Completed',
};

const STATUS_TONE: Record<ReservationStatus, BadgeTone> = {
  requested: 'warning',
  countered: 'warning',
  accepted: 'success',
  declined: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
  completed: 'success',
};

export function ReservationStatusPill({ status }: { status: ReservationStatus }) {
  return <Badge kind="status" label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />;
}

export default ReservationStatusPill;
