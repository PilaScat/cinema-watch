import { common } from "./common.js";
import { home } from "./home.js";
import { hunts } from "./hunts.js";
import { log } from "./log.js";
import { performance } from "./performance.js";
import { search } from "./search.js";
import { settings } from "./settings.js";
import { theatres } from "./theatres.js";

export const ui = { common, home, hunts, theatres, search, performance, log, settings } as const;
