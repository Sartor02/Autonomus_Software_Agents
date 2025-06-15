export const Desires = {
    STRATEGY_CAMPER_SPAWN: {
        id: "strategy_camper_spawn",
        description: "Prioritize parcel collection and exploration within limited spawn areas due to few spawn tiles.",
    },
    STRATEGY_FOCUS_SPAWN_EXPLORATION: {
        id: "strategy_focus_spawn_exploration",
        description: "Prioritize exploration and parcel collection on spawn tiles due to high density of spawn tiles.",
    },
    STRATEGY_GENERAL_EXPLORATION: {
        id: "strategy_general_exploration",
        description: "Explore all walkable areas to gain comprehensive map knowledge.",
    },
};

export function getDesireById(id) {
    return Object.values(Desires).find(desire => desire.id === id);
}