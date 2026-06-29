// How a pane's sidebar status dot looks, resolved through three layers: built-in default → global
// (Settings → Appearance → Status colours/animation) → the pane's profile override. Pure + shared.

export type StatusState = 'working' | 'claudeWorking' | 'attention' | 'exited';
export const STATUS_STATES: readonly StatusState[] = ['working', 'claudeWorking', 'attention', 'exited'];
export type StatusAnim = 'pulse' | 'static';

export const STATUS_LABELS: Record<StatusState, string> = {
  working: 'Active',
  claudeWorking: 'Claude working',
  attention: 'Needs input',
  exited: 'Exited',
};
export const DEFAULT_STATUS_COLORS: Record<StatusState, string> = {
  working: '#3fb950',
  claudeWorking: '#d97757',
  attention: '#d29922',
  exited: '#f85149',
};
export const DEFAULT_STATUS_ANIM: Record<StatusState, StatusAnim> = {
  working: 'pulse',
  claudeWorking: 'pulse',
  attention: 'static',
  exited: 'static',
};

/** A profile's optional status override. Absent fields fall through to the global/built-in default. */
export interface ProfileStatus {
  /** false = don't show a status dot for this profile's panes at all */
  enabled?: boolean;
  colors?: Partial<Record<StatusState, string>>;
  animations?: Partial<Record<StatusState, StatusAnim>>;
}

/** The global (Appearance) status settings: '' for a state = use the built-in default. */
export interface GlobalStatus {
  statusColors: Record<StatusState, string>;
  statusAnimations: Record<StatusState, StatusAnim | ''>;
}

export interface ResolvedStatus {
  enabled: boolean;
  color: string; // #hex
  animated: boolean;
}

/** Resolve one state for a pane: the profile override wins, then the global setting, then the built-in. */
export function resolveStatus(state: StatusState, profile: ProfileStatus | undefined, g: GlobalStatus): ResolvedStatus {
  return {
    enabled: profile?.enabled ?? true,
    color: profile?.colors?.[state] || g.statusColors[state] || DEFAULT_STATUS_COLORS[state],
    animated: (profile?.animations?.[state] || g.statusAnimations[state] || DEFAULT_STATUS_ANIM[state]) === 'pulse',
  };
}
