export class DeliveryStrategy {
    constructor(beliefs) {
        this.beliefs = beliefs;
        this.carriedParcels = [];
        this.deliveryThreshold = 12; // Reward minimo per deviare
        this.maxDetourDistance = 3; // Distanza massima per deviazione
    }

    shouldDeliver() {
        // Consegna sempre se abbiamo pacchi
        return this.carriedParcels.length > 0;
    }

    getDeliveryAction() {
        if (!this.shouldDeliver()) return null;

        const currentPos = this.beliefs.myPosition;
        
        // Se siamo già su una tile di consegna
        if (this.beliefs.isDeliveryTile(currentPos.x, currentPos.y)) {
            return { action: 'putdown' };
        }

        // Valuta se prendere un pacco vicino durante la consegna
        const detourParcel = this.evaluateDetourParcels();
        if (detourParcel) {
            if (this.isAtPosition(detourParcel.x, detourParcel.y)) {
                return { action: 'pickup', target: detourParcel.id };
            }
            return this.calculateMoveTowards(detourParcel.x, detourParcel.y);
        }

        // Prosegui verso la consegna
        return this.moveToDeliveryTile();
    }

    evaluateDetourParcels() {
        if (this.carriedParcels.length >= 3) return null; // Troppi pacchi già caricati

        const currentPos = this.beliefs.myPosition;
        const deliveryTile = this.beliefs.getClosestDeliveryTile(currentPos.x, currentPos.y);
        if (!deliveryTile) return null;

        const basePathLength = this.beliefs.calculateDistance(
            currentPos.x, currentPos.y, 
            deliveryTile.x, deliveryTile.y
        );

        return this.beliefs.availableParcels
            .filter(p => !p.carriedBy && p.reward > this.deliveryThreshold)
            .map(p => {
                const detourDistance = this.beliefs.calculateDistance(currentPos.x, currentPos.y, p.x, p.y);
                const totalDistance = detourDistance + 
                    this.beliefs.calculateDistance(p.x, p.y, deliveryTile.x, deliveryTile.y);
                
                return {
                    ...p,
                    detourScore: (p.reward * 2) / (totalDistance - basePathLength + 1),
                    detourDistance
                };
            })
            .filter(p => p.detourDistance <= this.maxDetourDistance)
            .sort((a, b) => b.detourScore - a.detourScore)[0];
    }

    moveToDeliveryTile() {
        const currentPos = this.beliefs.myPosition;
        const targetTile = this.beliefs.getClosestDeliveryTile(currentPos.x, currentPos.y);
        if (!targetTile) return null;

        return this.calculateMoveTowards(targetTile.x, targetTile.y);
    }

    calculateMoveTowards(targetX, targetY) {
        const currentPos = this.beliefs.myPosition;
        const dx = targetX - currentPos.x;
        const dy = targetY - currentPos.y;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            return { action: dx > 0 ? 'move_right' : 'move_left' };
        } else {
            return { action: dy > 0 ? 'move_up' : 'move_down' };
        }
    }

    updateCarriedParcels(parcels) {
        this.carriedParcels = parcels.filter(p => p.carriedBy === this.beliefs.myId);
    }

    isAtPosition(x, y) {
        const current = this.beliefs.myPosition;
        return Math.floor(current.x) === x && Math.floor(current.y) === y;
    }
}