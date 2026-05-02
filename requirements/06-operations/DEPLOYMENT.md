# [Project Name] — Deployment Guide

<!-- GUIDANCE: How to get your product from code to production. Step-by-step, including rollback procedures. -->

## Environments

| Environment | URL | Purpose | Deploy trigger |
|-------------|-----|---------|---------------|
| Development | localhost:3000 | Local dev | Manual |
| Staging | <!-- URL --> | Pre-production testing | PR merge to staging branch |
| Production | <!-- URL --> | Live users | Manual deploy after staging verification |

## Deploy Process

<!-- GUIDANCE: Step-by-step deployment procedure. Include: pre-deploy checks, deploy command, post-deploy verification, rollback procedure. -->

## Environment Variables

<!-- GUIDANCE: List ALL env vars needed per environment. Use project-config.json requiredEnvKeys for automated checking. NEVER include actual values here. -->

| Variable | Required | Description |
|----------|----------|-------------|

## Monitoring

<!-- GUIDANCE: What do you monitor in production? Uptime, error rates, response times, key business metrics. What triggers alerts? -->
