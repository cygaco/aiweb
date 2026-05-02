import {
  DefaultExecutionEventBusManager,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import type { RequestHandler } from "express";
import { agentCard } from "./agent-card.js";
import { PizzaAgentExecutor } from "./executor.js";

export interface A2AHandlers {
  cardHandler: RequestHandler;
  jsonRpcHandler: RequestHandler;
}

export function buildA2AHandlers(): A2AHandlers {
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    new InMemoryTaskStore(),
    new PizzaAgentExecutor(),
    new DefaultExecutionEventBusManager(),
  );

  return {
    cardHandler: agentCardHandler({ agentCardProvider: requestHandler }),
    jsonRpcHandler: jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  };
}
