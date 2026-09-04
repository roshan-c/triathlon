import { makeFunctionReference } from "convex/server";

const query = (path: string) => makeFunctionReference<"query">(path);
const mutation = (path: string) => makeFunctionReference<"mutation">(path);

export const cvx = {
  users: {
    me: query("users:me"),
    syncProfile: mutation("users:syncProfile")
  },
  projects: {
    myProject: query("projects:myProject"),
    listMine: query("projects:listMine"),
    summary: query("projects:summary"),
    canCreate: query("projects:canCreate"),
    create: mutation("projects:create"),
    members: query("projects:members")
  },
  tickets: {
    board: query("tickets:board"),
    list: query("tickets:list"),
    get: query("tickets:get"),
    dependencies: query("tickets:dependencies"),
    create: mutation("tickets:create"),
    update: mutation("tickets:update"),
    move: mutation("tickets:move"),
    comment: mutation("tickets:comment"),
    close: mutation("tickets:close"),
    addBlockedBy: mutation("tickets:addBlockedBy"),
    removeBlockedBy: mutation("tickets:removeBlockedBy"),
    toggleBlocks: mutation("tickets:toggleBlocks"),
    remove: mutation("tickets:remove"),
    attachToSprint: mutation("tickets:attachToSprint"),
    requestReview: mutation("tickets:requestReview"),
    approveReview: mutation("tickets:approveReview"),
    rejectReview: mutation("tickets:rejectReview"),
    activity: query("tickets:activity")
  },
  sprints: {
    list: query("sprints:list"),
    create: mutation("sprints:create"),
    activate: mutation("sprints:activate"),
    complete: mutation("sprints:complete")
  },
  metrics: {
    forSprint: query("metrics:forSprint"),
    velocityHistory: query("metrics:velocityHistory")
  },
  whiteboards: {
    getUploadUrl: mutation("whiteboards:getUploadUrl"),
    createShare: mutation("whiteboards:createShare"),
    getSharedSnapshot: query("whiteboards:getSharedSnapshot"),
    listLibrary: query("whiteboards:listLibrary"),
    saveToLibrary: mutation("whiteboards:saveToLibrary")
  }
};

export type Priority = "low" | "medium" | "high";
