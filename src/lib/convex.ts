export const cvx = {
  users: {
    me: "users:me" as any,
    syncProfile: "users:syncProfile" as any
  },
  projects: {
    myProject: "projects:myProject" as any,
    listMine: "projects:listMine" as any,
    summary: "projects:summary" as any,
    canCreate: "projects:canCreate" as any,
    create: "projects:create" as any,
    members: "projects:members" as any
  },
  boards: {
    getBoard: "boards:getBoard" as any,
    createCard: "boards:createCard" as any,
    updateCard: "boards:updateCard" as any,
    moveCard: "boards:moveCard" as any,
    deleteCard: "boards:deleteCard" as any,
    attachCardToSprint: "boards:attachCardToSprint" as any,
    activity: "boards:activity" as any
  },
  sprints: {
    list: "sprints:list" as any,
    create: "sprints:create" as any,
    activate: "sprints:activate" as any,
    complete: "sprints:complete" as any
  },
  metrics: {
    forSprint: "metrics:forSprint" as any,
    velocityHistory: "metrics:velocityHistory" as any
  },
  whiteboards: {
    getUploadUrl: "whiteboards:getUploadUrl" as any,
    createShare: "whiteboards:createShare" as any,
    getSharedSnapshot: "whiteboards:getSharedSnapshot" as any,
    listLibrary: "whiteboards:listLibrary" as any,
    saveToLibrary: "whiteboards:saveToLibrary" as any
  }
};

export type Priority = "low" | "medium" | "high";
