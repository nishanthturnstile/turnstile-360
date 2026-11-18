import type { AssignmentView } from '../../contracts/module-assignments.ts';
import type { ProductRecord } from '../../contracts/registry.ts';

export function productGuidance(
  product: Pick<
    ProductRecord,
    'policyState' | 'pairingVerifiedAt' | 'currentActivationAcknowledgedAt'
  >,
) {
  if (product.policyState === 'suspended' || product.policyState === 'rejected')
    return {
      title: product.policyState === 'suspended' ? 'Product suspended' : 'Product rejected',
      description:
        'Review the policy and reason below. Reapproval is an explicit staff decision; pairing and customer access remain separate.',
      tone: 'danger' as const,
    };
  if (!product.pairingVerifiedAt)
    return {
      title: 'Connect this product',
      description:
        'Download a private pairing file and ask the customer operator to pair this product. Approval becomes available after pairing is verified.',
      tone: 'warning' as const,
    };
  if (product.policyState !== 'approved')
    return {
      title: 'Ready for product approval',
      description:
        'Pairing is verified. Review the product decision below to approve this deployment with current MFA.',
      tone: 'info' as const,
    };
  if (!product.currentActivationAcknowledgedAt)
    return {
      title: 'Waiting for customer sync',
      description:
        'Central approval is saved. The customer product must sync and acknowledge the current decision. Refresh this record to check progress.',
      tone: 'warning' as const,
    };
  return {
    title: 'Product approval acknowledged',
    description:
      'The customer has acknowledged this product decision. For Turnstile, review module activation separately. Local setup and user permissions still apply.',
    tone: 'success' as const,
  };
}

export function moduleGuidance(view: AssignmentView) {
  if (view.archived)
    return {
      title: 'This client is archived',
      description:
        'Module assignments are read-only. Restore the client from its details page before making changes.',
      href: `/clients/${view.binding.clientId}`,
      label: 'View client',
    };
  if (!view.handover.authorityReady)
    return {
      title: 'Reconcile central recovery first',
      description:
        'Central recovery reconciliation is required before issuing or activating module authority.',
      href: '#module-handover',
      label: 'Review handover',
    };
  if (!view.desired)
    return {
      title: view.draft ? 'Review and approve your selection' : 'Choose the modules to install',
      description: view.draft
        ? 'A draft is saved. Confirm the full module set and approve the desired assignment. A changed product revision requires a new draft review.'
        : 'Select a published catalogue, choose Individual modules and save a draft. Core modules are always included.',
      href: '#module-selection',
      label: 'Review selection',
    };
  if (!view.delivery)
    return {
      title: 'Build the approved package',
      description:
        'Download the approved profile build request and pass it to the release operator. Continue when a matching verified package is available.',
      href: '#module-delivery',
      label: 'View package step',
    };
  if (view.policyState === 'suspended' || view.policyState === 'rejected')
    return {
      title: 'Review the restricted product',
      description:
        'This product policy currently restricts access. Review it on the client page before activating modules.',
      href: `/clients/${view.binding.clientId}`,
      label: 'Review product policy',
    };
  if (view.statuses.includes('inventory-mismatch') || view.statuses.includes('upgrade-required'))
    return {
      title: 'Reconcile the installed package',
      description:
        'The reported installation needs a reviewed upgrade or package reconciliation. Keep its existing identities and data; ask the customer operator to use the owning upgrade procedure.',
      href: '#module-handover',
      label: 'Review installation',
    };
  if (!view.inventory)
    return {
      title: 'Prepare the customer installation',
      description:
        'Deliver the verified bundle and setup metadata to the customer operator. A fresh central reservation can use a signed installation intent; existing installations use their owning adoption or upgrade procedure.',
      href: '#module-intent',
      label: 'View setup step',
    };
  if (
    view.policyState !== 'approved' ||
    view.handover.products.some((p) => p.productId === view.binding.productId && !p.paired)
  )
    return {
      title: 'Pair and approve this product',
      description:
        'Review pairing and the independent product approval on the client page before module activation.',
      href: `/clients/${view.binding.clientId}`,
      label: 'Review product setup',
    };
  if (view.minimumDecisionVersion === 1)
    return {
      title: 'Require signed module decisions',
      description:
        'An Administrator must review the permanent v2 enforcement step before modules can activate. This step grants no module access.',
      href: '#module-enforcement',
      label: 'Review enforcement',
    };
  if (view.statuses.includes('awaiting-acknowledgement'))
    return {
      title: 'Wait for the signed acknowledgement',
      description:
        'Central activation is approved. Ask the customer operator to sync, then refresh this page. Customer permissions remain independent.',
      href: '#module-handover',
      label: 'Check handover',
    };
  if (view.statuses.includes('active') && !view.statuses.includes('restricted'))
    return {
      title: 'Module activation acknowledged',
      description:
        'The current profile has a valid reported acknowledgement. Check both products and complete customer administrator handover and explicit permissions.',
      href: '#module-handover',
      label: 'Review handover',
    };
  return {
    title: 'Review module activation',
    description:
      'Check the exact installed package, fresh inventory, product approval and current MFA, then explicitly activate the approved profile.',
    href: '#module-activation',
    label: 'Review activation',
  };
}
