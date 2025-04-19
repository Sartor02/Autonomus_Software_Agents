export class DeliveryStrategy {
    constructor(beliefs, pathfinder) {
        this.beliefs = beliefs;
        this.pathfinder = pathfinder;
        this.carriedParcels = [];
        this.deliveryThreshold = 12; // Minimum reward to consider a parcel for detour
        this.maxDetourDistance = 5; // Increased max detour distance slightly
        this.deliveryPath = [];
    }

    shouldDeliver() {
        // Deliver always if we have parcels
        return this.carriedParcels.length > 0;
    }

    getDeliveryAction() {
        if (!this.shouldDeliver()) return null;

        const currentPos = this.beliefs.myPosition;
         if (!currentPos) {
             console.log("Delivery strategy: Agent position unknown.");
             return null;
         }

        // If we are already on a delivery tile
        if (this.beliefs.isDeliveryTile(currentPos.x, currentPos.y)) {
             console.log("At delivery tile, putting down.");
            this.deliveryPath = []; // Clear delivery path after arriving
            return { action: 'putdown' };
        }

        // Evaluate if picking up a nearby parcel during delivery is worthwhile
        //FIXME: This if condition should check the reward time of the parcel, not the number of parcels carried 
        if (this.carriedParcels.length < 3 ){
             const detourParcel = this.evaluateDetourParcels();
             if (detourParcel) {
                 console.log(`Considering detour for parcel ${detourParcel.id} at ${detourParcel.x}, ${detourParcel.y}`);
                 // Check if at detour parcel location
                 if (this.isAtPosition(detourParcel.x, detourParcel.y, currentPos.x, currentPos.y)) {
                     console.log(`At detour parcel, picking up.`);
                     return { action: 'pickup', target: detourParcel.id };
                 }
                 // Calculate path to detour parcel (this overrides delivery path temporarily)
                  if (this.deliveryPath.length === 0 || !this.isPathLeadingTo(this.deliveryPath, detourParcel.x, detourParcel.y)) {
                     this.deliveryPath = this.pathfinder.findPath(currentPos.x, currentPos.y, detourParcel.x, detourParcel.y);
                     console.log(`Calculated detour path: ${this.deliveryPath.length} steps.`);
                  }
                 // Follow the detour path
                 return this.followDeliveryPath(currentPos.x, currentPos.y);
             }
        }


         // If delivery path is empty or doesn't lead to the closest delivery tile, calculate it
         const closestDeliveryTile = this.beliefs.getClosestDeliveryTile(currentPos.x, currentPos.y);
         if (!closestDeliveryTile) {
             console.warn("No delivery tiles found in beliefs.");
             this.deliveryPath = []; // Clear path if target disappeared
             return null; // Cannot deliver if no delivery tile exists
         }

         if (this.deliveryPath.length === 0 || !this.isPathLeadingTo(this.deliveryPath, closestDeliveryTile.x, closestDeliveryTile.y)) {
             console.log(`Calculating path to closest delivery tile ${closestDeliveryTile.x}, ${closestDeliveryTile.y}`);
              this.deliveryPath = this.pathfinder.findPath(currentPos.x, currentPos.y, closestDeliveryTile.x, closestDeliveryTile.y);
              console.log(`Calculated delivery path: ${this.deliveryPath.length} steps.`);
         }

        // Follow the calculated delivery path
         return this.followDeliveryPath(currentPos.x, currentPos.y);
    }

    evaluateDetourParcels() {
        //FIXME: As the if above, this should check the reward time of the parcel, not the number of parcels carried 
        if (this.carriedParcels.length >= 3) return null; // Max parcels carried

        const currentPos = this.beliefs.myPosition;
        const deliveryTile = this.beliefs.getClosestDeliveryTile(currentPos.x, currentPos.y);
        if (!deliveryTile) return null;

        //FIXME: This could be quite expensive
        const basePathLength = this.pathfinder.findPath(currentPos.x, currentPos.y, deliveryTile.x, deliveryTile.y).length;
        if (basePathLength === 0 && !this.isAtPosition(currentPos.x, currentPos.y, deliveryTile.x, deliveryTile.y)) {
             console.warn("Cannot find path to closest delivery tile for detour evaluation.");
             return null; // Cannot evaluate detour if delivery is unreachable
        }


        let bestDetourParcel = null;
        let bestDetourScore = -Infinity;

        // Filter parcels by threshold and check reachability
         const potentialDetourParcels = this.beliefs.availableParcels
             .filter(p => !p.carriedBy && p.reward > this.deliveryThreshold)
             .filter(p => {
                  // Quick check if within rough Manhattan distance first
                  const manhattanDist = this.beliefs.calculateDistance(p.x, p.y);
                  return manhattanDist <= this.maxDetourDistance;
             });


        for (const parcel of potentialDetourParcels) {
             // Calculate detour path length using A*
             const pathToParcel = this.pathfinder.findPath(currentPos.x, currentPos.y, parcel.x, parcel.y);
             if (pathToParcel.length === 0 && !this.isAtPosition(currentPos.x, currentPos.y, parcel.x, parcel.y)) {
                  continue; // Parcel is unreachable
             }

             const pathFromParcelToDelivery = this.pathfinder.findPath(parcel.x, parcel.y, deliveryTile.x, deliveryTile.y);
             if (pathFromParcelToDelivery.length === 0 && !this.isAtPosition(parcel.x, parcel.y, deliveryTile.x, deliveryTile.y)) {
                 continue; // Delivery tile is unreachable from parcel
             }

            const detourDistance = pathToParcel.length; // Steps to reach the parcel
            const totalDistance = detourDistance + pathFromParcelToDelivery.length; // Total steps for detour

            // Check if the detour is within the allowed distance increase compared to the base path
            const addedSteps = totalDistance - basePathLength; // Steps added compared to going directly to delivery

            if (addedSteps <= this.maxDetourDistance) {
                // Score: reward / (added steps + 1)
                const detourScore = (parcel.reward * 2) / (addedSteps + 1);

                if (detourScore > bestDetourScore) {
                    bestDetourScore = detourScore;
                    bestDetourParcel = parcel;
                }
            }
        }

        if (bestDetourParcel) {
             console.log(`Selected detour parcel ${bestDetourParcel.id} with score ${bestDetourScore}`);
        }

        return bestDetourParcel;
    }


    followDeliveryPath(currentX, currentY) {
         if (this.deliveryPath.length === 0) {
             return null; // No path to follow
         }

         const nextStep = this.deliveryPath[0];

         const action = this.pathfinder.getActionToNextStep(currentX, currentY, nextStep.x, nextStep.y);

         if (action) {
             this.deliveryPath.shift(); // Remove the step we are about to take
             return { action: action };
         } else {
             console.error(`Delivery strategy: Could not determine action for step ${currentX},${currentY} -> ${nextStep.x},${nextStep.y}. Clearing path.`);
             this.deliveryPath = [];
             return null;
         }
    }

    // Helper to check if the current path is leading to a specific target
     isPathLeadingTo(path, targetX, targetY) {
         if (path.length === 0) return false;
         const finalStep = path[path.length - 1];
         return finalStep.x === targetX && finalStep.y === targetY;
     }


    updateCarriedParcels(allParcels) {
        // Find parcels carried by this agent
         if (this.beliefs.myId !== null) {
             this.carriedParcels = allParcels.filter(p => p.carriedBy === this.beliefs.myId);
             // Clear delivery path if we just dropped off the last parcel
             if (this.carriedParcels.length === 0 && this.deliveryPath.length > 0) {
                 console.log("Just delivered last parcel, clearing delivery path.");
                 this.deliveryPath = [];
             }
         } else {
             this.carriedParcels = []; // Cannot determine carried parcels without agent ID
         }
    }

    isAtPosition(x1, y1, x2, y2) {
         return x1 === x2 && y1 === y2;
    }
}