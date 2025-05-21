// desires/index.js

export const Desires = {
    MAXIMIZE_SCORE: {
        id: "maximize_score",
        description: "To achieve the highest possible score in the game.",
    },
    GAIN_KNOWLEDGE: {
        id: "gain_knowledge",
        description: "To explore the map and update beliefs about unknown areas and dynamic elements.",
    },
    STAY_ACTIVE: {
        id: "stay_active",
        description: "To prevent the agent from becoming immobile or idle.",
    },
    // Nuovi desideri/strategie per l'esplorazione, collegati a GAIN_KNOWLEDGE o MAXIMIZE_SCORE
    STRATEGY_CAMPER_SPAWN: {
        id: "strategy_camper_spawn",
        description: "Prioritize parcel collection and exploration within limited spawn areas due to few spawn tiles.",
        parentDesire: "gain_knowledge",
    },
    STRATEGY_FOCUS_SPAWN_EXPLORATION: {
        id: "strategy_focus_spawn_exploration",
        description: "Prioritize exploration and parcel collection on spawn tiles due to high density of spawn tiles.",
        parentDesire: "gain_knowledge",
    },
    STRATEGY_GENERAL_EXPLORATION: {
        id: "strategy_general_exploration",
        description: "Explore all walkable areas to gain comprehensive map knowledge.",
        parentDesire: "gain_knowledge",
    },
};

export function getDesireById(id) {
    return Object.values(Desires).find(desire => desire.id === id);
}