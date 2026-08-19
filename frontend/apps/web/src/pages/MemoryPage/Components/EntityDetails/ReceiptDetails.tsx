import { GlobalUID } from '@ci/common';
import { Link } from 'react-router-dom';

import { RECEIPT_FRAGMENT } from '@/components/entities/grid/ReceiptGridItem';
import { useFragment } from '@/graphql';
import { formatMinor } from '@/lib/money';

import type { MemoryEntityOf } from '../../useEntityService';

import { EntityDetailScaffold } from './EntityDetailScaffold';

interface Props {
  entity: MemoryEntityOf<'ReceiptType'>;
}

/**
 * A purchase document. Read-only in the drawer — the line items and the source
 * evidence need the room of the full page, which the scaffold links to.
 */
export function ReceiptDetails({ entity }: Props) {
  const data = useFragment(RECEIPT_FRAGMENT, entity);

  const purchasedAt = data.purchasedAt ? new Date(data.purchasedAt) : null;
  const lineCount = data.lineItems.length;

  return (
    <EntityDetailScaffold
      entity={entity}
      title={data.merchantName || 'Receipt'}
      subtitle="Receipt"
      taggable
      metaItems={[
        { label: 'Total', value: formatMinor(data.totalMinor, data.receiptCurrency) },
        {
          label: 'Purchased',
          value:
            purchasedAt && !Number.isNaN(purchasedAt.getTime()) ? purchasedAt.toLocaleDateString() : null,
        },
        { label: 'Order number', value: data.orderNumber },
        { label: 'Lines', value: lineCount > 0 ? String(lineCount) : null },
        { label: 'Extraction', value: data.extractionState },
        {
          label: 'Open',
          value: (
            <Link to={`/receipts/${GlobalUID.parse('receipt', data.id)}`} className="hover:underline">
              Full receipt
            </Link>
          ),
        },
      ]}
      rawData={data}
    />
  );
}
