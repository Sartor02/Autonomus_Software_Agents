; Domain definition for Deliveroo Agent
(define (domain deliveroo)
    (:requirements :strips :typing :fluents :durative-actions) ; :durative-actions if you will use durations, otherwise remove
    (:types tile parcel) ; Define types: tile (map cell), parcel (package)

    (:predicates
        ; Predicates for the agent's position
        (at ?t - tile)

        ; Predicates for the map topology
        (connected ?from ?to - tile) ; Indicates that ?from and ?to are adjacent and reachable cells
        (walkable ?t - tile)         ; Indicates if a tile is walkable (not a permanent obstacle)
        (blocked ?t - tile)          ; Indicates if a tile is blocked (a permanent obstacle, complementary to walkable)

        ; Predicates for parcels
        (parcel ?p - parcel)         ; Indicates that ?p is a parcel
        (at_parcel ?p - parcel ?t - tile) ; Indicates that parcel ?p is on tile ?t
        (has ?p - parcel)            ; Indicates that the agent has parcel ?p in possession

        ; Predicates for delivery points
        (delivery_tile ?t - tile)    ; Indicates that ?t is a delivery tile
    )

    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    ; Agent actions
    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

    (:action move
        :parameters (?from ?to - tile)
        :precondition (and
            (at ?from)          ; The agent must be on the starting tile
            (connected ?from ?to) ; The starting and destination tiles must be connected
            (walkable ?to)      ; The destination tile must be walkable
        )
        :effect (and
            (not (at ?from))    ; The agent is no longer on the starting tile
            (at ?to)            ; The agent is on the destination tile
        )
    )

    (:action pickup
        :parameters (?p - parcel ?l - tile)
        :precondition (and
            (at ?l)             ; The agent must be on the same tile as the parcel
            (at_parcel ?p ?l)   ; The parcel must be on the tile
            (not (has ?p))      ; The agent must not already have the parcel
        )
        :effect (and
            (has ?p)            ; The agent now has the parcel
            (not (at_parcel ?p ?l)) ; The parcel is no longer on the tile (it has been picked up)
        )
    )

    (:action putdown
        :parameters (?p - parcel ?l - tile)
        :precondition (and
            (at ?l)             ; The agent must be on the delivery tile
            (has ?p)            ; The agent must have the parcel
            (delivery_tile ?l)  ; The tile must be a delivery point
        )
        :effect (and
            (not (has ?p))      ; The agent no longer has the parcel
            ; Add effects for scoring or for the permanent removal of the parcel if the game requires it
            ; (delivered ?p)
        )
    )
)