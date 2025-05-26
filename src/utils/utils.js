// File used for all constants
import fs from 'fs'
export const BLOCKED_TIMEOUT = 2; // Threshold: after BLOCKED_TIMEOUT turns blocked on the same target tile, recalculate path
export const STUCK_TIMEOUT = 5; // Threshold: if agent position doesn't change for STUCK_TIMEOUT turns, clear path
export const BAN_DURATION = 10; // How many turns to ban a blocked/unreachable parcel
export const MIN_GENERAL_REWARD = 5; // Minimum reward for a parcel to be considered generally
export const NEARBY_DISTANCE_THRESHOLD = 5; // Distance threshold for picking up low-reward parcels
export const DELIVERY_THRESHOLD = 5; // Minimum reward to consider a parcel for detour
export const MAX_DETOUR_DISTANCE = 10; // Increased max detour distance slightly
export const SPAWN_TILES_THRESHOLD = 25 // If the number of spawn tiles is less than this, consider them for detour
export const SPAWN_TILES_HIGH_FACTOR = 1; // If the number of spawn tiles is more than normal tiles + this, consider them for detour
export const TARGET_LOST_THRESHOLD = 10; // How many turns to wait before giving up on a target parcel
export const USE_PDDL_PLANNER = false; // Use PDDL planner for pathfinding
export const HANDSHAKE = '[DESCANTA_HANDSHAKE_INIT]'; // Handshake message to identify the agent
export const INTENT = '[DESCANTA_INTENT]'; // Intent message to announce target and area
export const RUNNER = 'runner';
export const CARRIER = 'carrier';

export const DIRECTIONS = [
    { dx: 0, dy: 1, action: 'move_up' },
    { dx: 0, dy: -1, action: 'move_down' },
    { dx: 1, dy: 0, action: 'move_right' },
    { dx: -1, dy: 0, action: 'move_left' },
]

export function isAtPosition(x1, y1, x2, y2) {
    return x1 === x2 && y1 === y2;
}

export function readFile(path) {
    return new Promise((res, rej) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (err) rej(err)
            else res(data)
        })
    })
}
