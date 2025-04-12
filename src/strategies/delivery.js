export class DeliveryStrategy {
    constructor(beliefs) {
        this.beliefs = beliefs;
        this.carriedParcels = [];
    }
  
    shouldDeliver() {
        /*return this.carriedParcels.length > 1 || 
               this.carriedParcels.some(p => p.reward <  14);*/
        return this.carriedParcels.length > 0;
    }
  
    getDeliveryAction() {
        if (!this.shouldDeliver()) return null;
        
        const currentPos = this.beliefs.myPosition;
        
        // Are we already on a delivery tile?
        if (this.beliefs.isDeliveryTile(currentPos.x, currentPos.y)) {
        return { action: 'putdown' };
        }

        // Find the closest delivery tile
        const targetTile = this.beliefs.getClosestDeliveryTile(currentPos.x, currentPos.y);
        if (!targetTile) return null;

        // Calculate the movement towards the delivery tile
        const dx = targetTile.x - currentPos.x;
        const dy = targetTile.y - currentPos.y;
        
        if (Math.abs(dx) > Math.abs(dy)) {
        return { action: dx > 0 ? 'move_right' : 'move_left' };
        } else {
        return { action: dy > 0 ? 'move_up' : 'move_down' };
        }
    }
  
    updateCarriedParcels(parcels) {
        this.carriedParcels = parcels.filter(p => p.carriedBy === this.beliefs.myId);
    }
  }