// File used for all constants
export const BLOCKED_TIMEOUT = 2; // Threshold: after BLOCKED_TIMEOUT turns blocked on the same target tile, recalculate path
export const STUCK_TIMEOUT = 5; // Threshold: if agent position doesn't change for STUCK_TIMEOUT turns, clear path
export const BAN_DURATION = 10; // How many turns to ban a blocked/unreachable parcel
export const MIN_GENERAL_REWARD = 10; // Minimum reward for a parcel to be considered generally
export const NEARBY_DISTANCE_THRESHOLD = 2; // Distance threshold for picking up low-reward parcels
export const DELIVERY_THRESHOLD = 12; // Minimum reward to consider a parcel for detour
export const MAX_DETOUR_DISTANCE = 5; // Increased max detour distance slightly
export const DIRECTIONS = [
    { dx: 0, dy: 1, action: 'move_up' },
    { dx: 0, dy: -1, action: 'move_down' },
    { dx: 1, dy: 0, action: 'move_right' },
    { dx: -1, dy: 0, action: 'move_left' },
]

export function isAtPosition(x1, y1, x2, y2) {
    return x1 === x2 && y1 === y2;
}

