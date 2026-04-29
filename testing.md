## Overview

Arguably uses unit tests, integration tests, mock-based tests, and end-to-end (E2E) tests to ensure functionality.

The testing stack includes:

* Vitest (unit, integration, and mock testing)
* Playwright (E2E testing)
* Real-time testing utilities using Socket.IO and mediasoup simulation


## 1. Unit, Integration, and Mock Tests

Unit, integration, and mock tests are implemented using Vitest and are located in the `__tests__` directory. These tests focus on verifying individual modules, functions, and components in isolation or controlled environments.

Unit tests validate the correctness of utility functions and services.


Integration tests ensure that testing API handlers do not rely on external systems.


Mock tests simulate dependencies using mock objects for deterministic testing.

In particular, mocking is a key part of the test suite and is fully supported by Vitest. It is used to isolate components by replacing external dependencies such as:
* Database operations (e.g., Prisma client)
* Authentication services
* External APIs (e.g., AI transcription services)
* WebSocket and real-time event handlers


The scope of these testing strategies includes:
* Authentication logic
* Utility and helper functions
* API route handlers (with mocked dependencies)
* Component behavior under controlled props and state


The test is automatically carried out by GitHub Action's Continuous Integration.  To see test results from the command line interface, do:

> `npm run test`


## 2. End-to-End (E2E) Tests

End-to-end tests are located in the `tests` directory and are implemented using Playwright. These tests simulate real user behavior in a full browser environment.

Purposes:
* Validate complete system workflows
* Ensure correct integration between frontend, backend, and database
* Test real-time user interactions under realistic conditions

Scope:
* User authentication flows
* Session creation and management
* Admin workflows
* Live debate participation
* Real-time communication setup

Again, GitHub Action takes care of the test executions.  To see them in the command line interface, do:
> `npx playwright test`


Test execution reports are stored in the `playwright-report` directory.


## 3. Real-Time System Testing

The application includes real-time communication features built using WebRTC-based media streaming and WebSocket signaling.

Components Tested:
* Socket.IO event-based signaling
* mediasoup transport and session initialization
* Multi-user synchronization in debate sessions
* Join/leave events and state updates

Testing Approaches:
* Simulated multi-client sessions in E2E tests
* Event-based validation of socket communication
* Mocked signaling flows for isolated unit tests
* Manual verification for media stream behavior



## 4. Test Environment Setup
Requirements:
* Node.js installed
* Environment variables configured
* Database instance running (PostgreSQL or Supabase)

Setup Steps:
> `npm install` \
> `npx prisma generate` \
> `npx prisma migrate dev`


## 5. Summary

The testing strategy is designed in layers:

* Unit & mock tests (Vitest) → Validate isolated logic and simulate dependencies
* Integration tests → Validate interactions between modules
* E2E tests (Playwright) → Validate full user workflows
* Real-time tests → Validate live communication systems

External dependencies are mocked where necessary to ensure test stability and repeatability.

Together, these layers ensure correctness at both the component and system level, providing confidence in application stability and user experience.