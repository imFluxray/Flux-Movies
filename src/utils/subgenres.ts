/*
 * Named subgenres, backed by TMDB keywords.
 *
 * TMDB has nineteen genres, which cannot tell a heist film from a war film.
 * Its keywords can, but on their own they are an unlabelled heap. These are
 * the keywords that behave like genres - each id checked against TMDB, each
 * one matching well over a hundred titles - under names fit to show a person.
 * Ids that only nearly matched, or matched a handful of titles, were left out.
 */

export interface Subgenre {
  id: number;
  name: string;
  group: string;
}

export const SUBGENRES: Subgenre[] = [
  { id: 10051, name: "Heist", group: "Crime and thriller" },
  { id: 12565, name: "Psychological thriller", group: "Crime and thriller" },
  { id: 207268, name: "Neo-noir", group: "Crime and thriller" },
  { id: 9807, name: "Film noir", group: "Crime and thriller" },
  { id: 12570, name: "Whodunit", group: "Crime and thriller" },
  { id: 10714, name: "Serial killer", group: "Crime and thriller" },
  { id: 214780, name: "Courtroom drama", group: "Crime and thriller" },
  { id: 209817, name: "Political thriller", group: "Crime and thriller" },
  { id: 470, name: "Spy", group: "Crime and thriller" },
  { id: 10410, name: "Conspiracy", group: "Crime and thriller" },
  { id: 3149, name: "Gangster", group: "Crime and thriller" },
  { id: 378, name: "Prison", group: "Crime and thriller" },
  { id: 9748, name: "Revenge", group: "Crime and thriller" },
  { id: 33722, name: "True crime", group: "Crime and thriller" },
  { id: 2157, name: "Hacker", group: "Crime and thriller" },

  { id: 4379, name: "Time travel", group: "Science fiction" },
  { id: 12190, name: "Cyberpunk", group: "Science fiction" },
  { id: 4565, name: "Dystopia", group: "Science fiction" },
  { id: 4458, name: "Post-apocalyptic", group: "Science fiction" },
  { id: 161176, name: "Space opera", group: "Science fiction" },
  { id: 14909, name: "Alien invasion", group: "Science fiction" },
  { id: 10854, name: "Time loop", group: "Science fiction" },
  { id: 4563, name: "Virtual reality", group: "Science fiction" },
  { id: 33465, name: "Parallel worlds", group: "Science fiction" },
  { id: 9715, name: "Superhero", group: "Science fiction" },

  { id: 12377, name: "Zombies", group: "Horror" },
  { id: 3133, name: "Vampires", group: "Horror" },
  { id: 12564, name: "Werewolves", group: "Horror" },
  { id: 3358, name: "Haunted house", group: "Horror" },
  { id: 12339, name: "Slasher", group: "Horror" },
  { id: 163053, name: "Found footage", group: "Horror" },
  { id: 295907, name: "Psychological horror", group: "Horror" },
  { id: 209568, name: "Folk horror", group: "Horror" },
  { id: 283085, name: "Body horror", group: "Horror" },
  { id: 215959, name: "Cosmic horror", group: "Horror" },
  { id: 158126, name: "Creature feature", group: "Horror" },

  { id: 161257, name: "Medieval", group: "Fantasy and myth" },
  { id: 234213, name: "Sword and sorcery", group: "Fantasy and myth" },
  { id: 3205, name: "Fairy tale", group: "Fantasy and myth" },
  { id: 2343, name: "Magic", group: "Fantasy and myth" },
  { id: 12554, name: "Dragons", group: "Fantasy and myth" },
  { id: 2035, name: "Mythology", group: "Fantasy and myth" },
  { id: 237451, name: "Isekai", group: "Fantasy and myth" },

  { id: 10349, name: "Survival", group: "Action and adventure" },
  { id: 10617, name: "Disaster", group: "Action and adventure" },
  { id: 779, name: "Martial arts", group: "Action and adventure" },
  { id: 1462, name: "Samurai", group: "Action and adventure" },
  { id: 7312, name: "Road trip", group: "Action and adventure" },
  { id: 168713, name: "Neo-western", group: "Action and adventure" },
  { id: 10168, name: "Aviation", group: "Action and adventure" },
  { id: 270, name: "Ocean", group: "Action and adventure" },

  { id: 10683, name: "Coming of age", group: "Heart and humour" },
  { id: 6270, name: "High school", group: "Heart and humour" },
  { id: 9914, name: "Slice of life", group: "Heart and humour" },
  { id: 6054, name: "Friendship", group: "Heart and humour" },
  { id: 248927, name: "Found family", group: "Heart and humour" },
  { id: 11800, name: "Mockumentary", group: "Heart and humour" },
  { id: 8201, name: "Satire", group: "Heart and humour" },
  { id: 10123, name: "Dark comedy", group: "Heart and humour" },
  { id: 9755, name: "Parody", group: "Heart and humour" },
  { id: 193171, name: "Sitcom", group: "Heart and humour" },
  { id: 210605, name: "Workplace comedy", group: "Heart and humour" },
  { id: 1415, name: "Small town", group: "Heart and humour" },
  { id: 240, name: "Underdog", group: "Heart and humour" },
  { id: 207317, name: "Christmas", group: "Heart and humour" },

  { id: 5565, name: "Biography", group: "Real stories" },
  { id: 9672, name: "Based on a true story", group: "Real stories" },
  { id: 12995, name: "Historical fiction", group: "Real stories" },
  { id: 1956, name: "World War II", group: "Real stories" },
  { id: 15060, name: "Period drama", group: "Real stories" },
  { id: 221355, name: "Nature documentary", group: "Real stories" },

  { id: 4344, name: "Musical", group: "Music and sport" },
  { id: 6075, name: "Sports", group: "Music and sport" },
  { id: 209476, name: "Boxing", group: "Music and sport" },
  { id: 9706, name: "Anthology", group: "Music and sport" },
];

export const SUBGENRE_GROUPS = [...new Set(SUBGENRES.map((sub) => sub.group))];

export const SUBGENRE_BY_ID = new Map(SUBGENRES.map((sub) => [sub.id, sub]));
