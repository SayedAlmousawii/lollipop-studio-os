# 001 Direction Not Sign

## Rule

`Payment.amount` is always positive; `Payment.direction` carries whether the movement is inbound or outbound.

## Why

Positive-only amounts prevent sign confusion in storage and make invariant checks easier to express and review.

## How To Apply

Create positive `Payment.amount` values for both incoming and outgoing flows, and derive settlement direction from `Payment.direction`.
