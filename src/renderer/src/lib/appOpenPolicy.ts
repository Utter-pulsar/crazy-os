import type { AppOpenPlan, ViewPersistenceIntent } from '@shared/types'

/**
 * A request that arrives while the first durable home is still being installed
 * is part of that home, not a throw-away runtime interaction.
 */
export function queuedOpenUpdatePersistence(homeInstallPending: boolean): ViewPersistenceIntent {
  return homeInstallPending ? 'upgrade-kit' : 'runtime'
}

/** A failed first create/conversion retry must still finish the durable target kit. */
export function openingRetryPersistence(plan: AppOpenPlan): ViewPersistenceIntent {
  return plan.disposition === 'reuse' ? 'runtime' : 'create-kit'
}
