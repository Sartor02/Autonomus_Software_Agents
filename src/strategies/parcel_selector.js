import { MIN_GENERAL_REWARD, NEARBY_DISTANCE_THRESHOLD, BAN_DURATION } from "../utils/utils.js";

export class ParcelSelector {
    constructor(beliefs) {
        this.beliefs = beliefs;
        this.bannedParcels = new Map();
        this.currentParcelTarget = null;
        this.targetLostTurns = 0;
        this.currentTurn = 0;
    }

    incrementTurn() {
        this.currentTurn += 1;
        this.cleanupExpiredBans();
    }

    cleanupExpiredBans() {
        const bannedParcelIdsToRemove = [];
        
        for (const [parcelId, banUntilTurn] of this.bannedParcels.entries()) {
            if (this.currentTurn >= banUntilTurn) {
                bannedParcelIdsToRemove.push(parcelId);
            } else {
                const parcelExists = this.beliefs.parcels.some(p => p.id === parcelId);
                if (!parcelExists) {
                    bannedParcelIdsToRemove.push(parcelId);
                }
            }
        }
        
        bannedParcelIdsToRemove.forEach(id => this.bannedParcels.delete(id));
    }

    updateParcelTarget() {
        const visibleParcels = this.beliefs.availableParcels;

        if (this.currentParcelTarget) {
            const stillVisible = visibleParcels.find(p => p.id === this.currentParcelTarget.id);
            if (stillVisible) {
                this.targetLostTurns = 0;
                return;
            } else {
                this.targetLostTurns += 1;
                if (this.targetLostTurns < 10) { // TARGET_LOST_THRESHOLD
                    return;
                }
            }
        }

        const bestParcel = this.selectBestParcel();
        if (bestParcel) {
            this.currentParcelTarget = bestParcel;
            this.targetLostTurns = 0;
        } else {
            this.currentParcelTarget = null;
        }
    }

    selectBestParcel(handoverTile = null, isRunner = false) {
        let availableAndNotBanned = this.beliefs.availableParcels.filter(p => !this.bannedParcels.has(p.id));

        // Exclude handover tile parcels if runner
        if (handoverTile && isRunner) {
            availableAndNotBanned = availableAndNotBanned.filter(
                p => !(p.x === handoverTile.x && p.y === handoverTile.y)
            );
        }

        if (!availableAndNotBanned.length) return null;

        // Filter by area assignment
        const myId = this.beliefs.myId;
        const otherIntents = this.beliefs.getOtherAgentsIntents(myId);
        
        let parcels = this.beliefs.availableParcels.filter(parcel => {
            const inMyArea = !this.beliefs.myAssignedArea ||
                this.beliefs.myAssignedArea.some(tile => tile.x === parcel.x && tile.y === parcel.y);
            return inMyArea && !otherIntents.some(intent =>
                intent.target && intent.target.x === parcel.x && intent.target.y === parcel.y
            );
        });

        if (parcels.length === 0) {
            parcels = this.beliefs.availableParcels;
        }

        // Filter by reward and distance
        let filteredByReward = availableAndNotBanned.filter(p => {
            const distanceToParcel = this.beliefs.calculateDistance(p.x, p.y);
            return p.reward >= MIN_GENERAL_REWARD || distanceToParcel <= NEARBY_DISTANCE_THRESHOLD;
        });

        if (!filteredByReward.length) return null;

        // Sort by efficiency
        return filteredByReward
            .map(p => ({
                ...p,
                efficiency: this.calculateParcelEfficiency(p)
            }))
            .sort((a, b) => b.efficiency - a.efficiency)[0];
    }

    calculateParcelEfficiency(parcel) {
        if (!this.beliefs.myPosition) return -Infinity;

        const distance = this.beliefs.calculateDistance(parcel.x, parcel.y);
        const originalReward = parcel.originalReward > 0 ? parcel.originalReward : 100;
        const timeFactor = parcel.reward / originalReward;

        return (parcel.reward * timeFactor) / (distance + 1);
    }

    banParcel(parcelId) {
        this.bannedParcels.set(parcelId, this.currentTurn + BAN_DURATION);
        console.log(`Banned parcel ${parcelId} until turn ${this.currentTurn + BAN_DURATION}`);
    }

    getCurrentTarget() {
        return this.currentParcelTarget;
    }
}