import { useEffect, useState } from "react";
import type { RouteName } from "../types";

const routes = new Set<RouteName>(["dashboard", "board", "backlog", "sprints", "metrics"]);

function readRoute(): RouteName {
  const value = window.location.pathname.split("/").filter(Boolean)[0] as RouteName | undefined;
  return value && routes.has(value) ? value : "dashboard";
}

export function useRoute(): [RouteName, (route: RouteName) => void] {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (next: RouteName) => {
    window.history.pushState({}, "", `/${next}`);
    setRoute(next);
  };
  return [route, navigate];
}
