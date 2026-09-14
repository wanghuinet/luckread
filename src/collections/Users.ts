import type { CollectionConfig } from 'payload'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: true,
  fields: [
    { name: 'role', type: 'select', required: true, defaultValue: 'user', options: ['user', 'verified_user', 'creator', 'ip_principal', 'mcn_admin', 'mcn_editor', 'editor', 'operator', 'moderator', 'admin', 'super_admin'].map((value) => ({ label: value, value })), index: true },
    { name: 'accountState', type: 'select', required: true, defaultValue: 'PENDING_VERIFICATION', options: ['PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'FROZEN', 'SUSPENDED', 'BANNED', 'DELETION_REQUESTED', 'DELETION_PENDING', 'DELETED', 'RESTORED', 'REACTIVATED'].map((value) => ({ label: value, value })), index: true },
    { name: 'permissions', type: 'json' },
    { name: 'entitlements', type: 'json' },
    { name: 'organizationScopes', type: 'json' },
  ],
  versions: false,
}
