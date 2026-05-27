# AI Movie Picker — notatka startowa do projektu 10xDevs

## 1. Robocza nazwa projektu

**MovieMate**  
Alternatywnie: **PickFlix**, **Co Oglądamy?**, **Movie Night Picker**

## 2. Krótki opis pomysłu

Aplikacja webowa, która pomaga parze szybko wybrać film na wieczór.

Problem polega na tym, że wybór filmu często trwa zbyt długo: użytkownicy scrollują Netflixa, HBO, Disney+, YouTube albo Filmweba, porównują opcje, odrzucają kolejne tytuły i finalnie często nie oglądają żadnego konkretnego filmu. Aplikacja ma skrócić ten proces do kilku minut.

Użytkownik tworzy sesję „movie night”, odpowiada na krótki wywiad dotyczący nastroju, preferencji, ograniczeń czasowych i rzeczy, których chce uniknąć. Aplikacja pobiera kandydatów filmowych z TMDB API, filtruje je według preferencji oraz historii obejrzanych filmów, a następnie generuje 3 rekomendacje z krótkim uzasadnieniem AI.

## 3. One-liner

> Aplikacja pomaga dwóm osobom wybrać film w kilka minut, łącząc krótki wywiad, historię obejrzanych filmów, dane z TMDB API i AI-owe uzasadnienie rekomendacji.

## 4. Główny problem

Nie brakuje filmów. Problemem jest zbyt duży wybór.

Użytkownicy mają dostęp do ogromnej liczby filmów, ale często nie wiedzą, co wybrać w danym momencie. Standardowe katalogi filmowe pokazują setki opcji, rankingi i listy, ale nie rozwiązują realnego problemu: „co mamy obejrzeć dzisiaj, biorąc pod uwagę nasz aktualny nastrój i preferencje obu osób?”.

## 5. Docelowy użytkownik

### Główna persona

Para lub dwie osoby, które regularnie oglądają filmy razem i często mają problem z wyborem konkretnego tytułu.

### Przykładowy scenariusz

Wojtek i jego dziewczyna chcą obejrzeć film wieczorem. Jedna osoba chce coś lekkiego, druga coś z zagadką albo napięciem. Nie chcą horroru ani bardzo ciężkiego dramatu. Mają około 2 godziny. Zamiast przeglądać katalogi streamingowe przez 40 minut, uruchamiają aplikację, odpowiadają na kilka pytań i dostają 3 propozycje.

## 6. Cel aplikacji

Celem aplikacji nie jest stworzenie kolejnej bazy filmów ani konkurencji dla Filmweb, Letterboxd lub JustWatch.

Celem jest stworzenie prostego decision helpera, który:

- ogranicza liczbę opcji,
- bierze pod uwagę preferencje dwóch osób,
- pamięta historię obejrzanych filmów,
- filtruje filmy, które nie pasują do aktualnego nastroju,
- pokazuje 3 konkretne rekomendacje,
- wyjaśnia, dlaczego dana rekomendacja ma sens.

## 7. Główna reguła biznesowa

> Aplikacja wybiera filmy, które najlepiej pasują do aktualnej sesji oglądania, uwzględniając preferencje obu osób, ograniczenia sesji, historię obejrzanych filmów oraz dane filmowe pobrane z TMDB API.

## 8. Zakres MVP

### Must-have

1. Logowanie użytkownika.
2. Możliwość utworzenia dwóch profili oglądających w ramach jednego konta.
3. Możliwość dodawania filmów do historii obejrzanych.
4. Wyszukiwanie filmów przez TMDB API podczas dodawania do historii.
5. Tworzenie nowej sesji „movie night”.
6. Formularz preferencji dla sesji:
   - nastrój,
   - preferowane gatunki,
   - wykluczone gatunki,
   - maksymalny czas trwania filmu,
   - poziom intensywności,
   - dodatkowa notatka tekstowa.
7. Pobieranie kandydatów filmowych z TMDB API.
8. Filtrowanie kandydatów według:
   - historii obejrzanych filmów,
   - wykluczonych gatunków,
   - limitu czasu trwania,
   - preferowanych gatunków.
9. Prosty scoring rekomendacji.
10. Wygenerowanie 3 rekomendacji:
   - safe pick,
   - compromise pick,
   - wild card.
11. Krótkie AI-owe uzasadnienie każdej rekomendacji.
12. Możliwość wybrania jednej rekomendacji.
13. Możliwość oznaczenia wybranego filmu jako obejrzany.
14. Możliwość oceny obejrzanego filmu.

## 9. Non-goals, czyli czego nie robić w MVP

W MVP nie budujemy:

- pełnej bazy filmów,
- własnego Filmweba lub Letterboxd,
- recenzji społecznościowych,
- komentarzy,
- kont wielu użytkowników w jednej grupie,
- zapraszania drugiej osoby linkiem,
- integracji z Netflix, HBO, Disney+, Prime Video,
- dokładnej informacji „gdzie obejrzeć film”,
- płatności,
- aplikacji mobilnej,
- powiadomień push,
- zaawansowanego chatu z AI jako głównego interfejsu,
- pełnego systemu rekomendacyjnego machine learning,
- importu historii z innych platform.

## 10. Integracja z TMDB API

### Decyzja

Aplikacja powinna korzystać z TMDB API już w MVP, ale w ograniczonym zakresie.

TMDB API jest źródłem danych filmowych, ale nie jest główną logiką aplikacji. Aplikacja nie powinna tylko wyświetlać wyników z API. Wartość projektu polega na tym, że aplikacja bierze dane z TMDB, a następnie sama filtruje, punktuje i uzasadnia rekomendacje.

### Do czego używać TMDB w MVP

1. Wyszukiwanie filmu po tytule.
2. Pobieranie szczegółów filmu:
   - tytuł,
   - rok,
   - opis,
   - plakat,
   - gatunki,
   - czas trwania,
   - średnia ocena,
   - popularność.
3. Pobieranie kandydatów do rekomendacji:
   - popularne filmy,
   - filmy z danego gatunku,
   - filmy wysoko oceniane,
   - filmy podobne do dobrze ocenionych tytułów.

### Czego nie robić z TMDB w MVP

1. Nie budować pełnej wyszukiwarki filmów.
2. Nie kopiować całej bazy TMDB do własnej bazy.
3. Nie opierać całej rekomendacji wyłącznie na popularności z TMDB.
4. Nie traktować watch providers jako obowiązkowej funkcji MVP.

## 11. Rola AI w projekcie

AI powinno wspierać decyzję, ale nie powinno być jedynym mechanizmem rekomendacji.

### AI w MVP może:

1. Interpretować dodatkową notatkę użytkownika, np.:
   - „coś lekkiego, ale nie głupiego”,
   - „thriller, ale bez ciężkiego klimatu”,
   - „coś podobnego do Knives Out”.
2. Pomagać w dopasowaniu nastroju do tagów filmowych.
3. Generować krótkie uzasadnienie rekomendacji.
4. Wyjaśniać, dlaczego film jest:
   - safe pick,
   - compromise pick,
   - wild card.

### AI nie powinno w MVP:

1. Samodzielnie wymyślać filmów bez sprawdzenia w TMDB.
2. Halucynować tytułów, lat produkcji lub opisów.
3. Decydować o wszystkim bez testowalnego scoringu po stronie aplikacji.
4. Zastępować całej logiki biznesowej.

## 12. Proponowany scoring rekomendacji

Przykładowe punkty:

- film zawiera preferowany gatunek osoby A: `+20`
- film zawiera preferowany gatunek osoby B: `+20`
- film zawiera gatunek wykluczony przez osobę A: `-40`
- film zawiera gatunek wykluczony przez osobę B: `-40`
- film mieści się w limicie czasu: `+15`
- film przekracza limit czasu: `-25`
- film nie był wcześniej oglądany: `+20`
- film był już oglądany: `-100`
- film jest podobny do dobrze ocenionego filmu: `+15`
- film pasuje do wybranego nastroju: `+25`
- film ma bardzo niską ocenę: `-10`
- film ma dobrą ocenę i sensowną popularność: `+10`

Przykładowa reguła:

```ts
finalScore =
  genreMatchScore +
  moodMatchScore +
  runtimeScore +
  historyScore +
  ratingScore -
  excludedGenrePenalty -
  alreadyWatchedPenalty
```

## 13. Typy rekomendacji

Aplikacja nie powinna pokazywać tylko „top 3 filmów”. Każda rekomendacja powinna mieć rolę.

### 1. Safe pick

Najbezpieczniejszy wybór. Film najlepiej pasujący do preferencji obu osób i bez dużych ryzyk.

### 2. Compromise pick

Film, który dobrze łączy preferencje obu osób, nawet jeśli nie jest idealny dla żadnej z nich.

### 3. Wild card

Film mniej oczywisty, ale nadal zgodny z nastrojem i ograniczeniami sesji.

## 14. Proponowany model danych

### User

```ts
User {
  id: string
  email: string
  name: string
  createdAt: Date
}
```

### ViewerProfile

Profile dwóch osób oglądających filmy w ramach jednego konta.

```ts
ViewerProfile {
  id: string
  userId: string
  name: string
  favoriteGenres: string[]
  dislikedGenres: string[]
  createdAt: Date
  updatedAt: Date
}
```

### MovieCache

Lokalny cache filmów pobranych z TMDB.

```ts
MovieCache {
  id: string
  tmdbId: number
  title: string
  originalTitle?: string
  year?: number
  overview?: string
  posterPath?: string
  genres: string[]
  runtime?: number
  voteAverage?: number
  popularity?: number
  createdAt: Date
  updatedAt: Date
}
```

### WatchedMovie

Historia obejrzanych filmów.

```ts
WatchedMovie {
  id: string
  userId: string
  tmdbId: number
  rating?: number
  watchedAt?: Date
  wouldWatchSimilar?: boolean
  notes?: string
  createdAt: Date
}
```

### MovieNightSession

Sesja wyboru filmu.

```ts
MovieNightSession {
  id: string
  userId: string
  status: "draft" | "recommended" | "selected" | "watched" | "cancelled"
  mood: string[]
  preferredGenres: string[]
  excludedGenres: string[]
  maxRuntime?: number
  intensity?: "light" | "medium" | "intense"
  extraNote?: string
  createdAt: Date
  updatedAt: Date
}
```

### Recommendation

Rekomendacja wygenerowana dla danej sesji.

```ts
Recommendation {
  id: string
  sessionId: string
  tmdbId: number
  score: number
  role: "safe_pick" | "compromise" | "wild_card"
  reason: string
  status: "proposed" | "selected" | "rejected"
  createdAt: Date
}
```

## 15. Główne user stories

### US-001 — Tworzenie profili oglądających

Jako zalogowany użytkownik chcę utworzyć dwa profile osób oglądających, aby aplikacja mogła brać pod uwagę preferencje obu osób.

**Given** użytkownik jest zalogowany  
**When** tworzy profile „Osoba A” i „Osoba B”  
**Then** aplikacja zapisuje profile i pozwala używać ich w sesji wyboru filmu

### US-002 — Dodanie obejrzanego filmu

Jako użytkownik chcę dodać film do historii obejrzanych, aby aplikacja nie polecała mi stale tych samych tytułów.

**Given** użytkownik jest zalogowany  
**When** wyszukuje film przez TMDB i zapisuje go jako obejrzany  
**Then** film pojawia się w historii obejrzanych

### US-003 — Start sesji movie night

Jako użytkownik chcę rozpocząć sesję wyboru filmu, aby szybko określić, na co mamy dziś ochotę.

**Given** użytkownik jest zalogowany  
**When** klika „Start movie night”  
**Then** aplikacja pokazuje formularz preferencji

### US-004 — Generowanie rekomendacji

Jako użytkownik chcę otrzymać 3 rekomendacje filmowe, aby szybko wybrać film bez długiego scrollowania.

**Given** użytkownik uzupełnił preferencje sesji  
**When** klika „Generate recommendations”  
**Then** aplikacja pobiera kandydatów z TMDB, liczy scoring i pokazuje 3 rekomendacje

### US-005 — Wybór filmu

Jako użytkownik chcę wybrać jedną rekomendację, aby zakończyć proces decyzyjny.

**Given** aplikacja pokazała 3 rekomendacje  
**When** użytkownik wybiera jedną z nich  
**Then** aplikacja oznacza rekomendację jako wybraną

### US-006 — Ocena po obejrzeniu

Jako użytkownik chcę ocenić obejrzany film, aby kolejne rekomendacje były lepiej dopasowane.

**Given** użytkownik wybrał film  
**When** oznacza film jako obejrzany i dodaje ocenę  
**Then** film trafia do historii obejrzanych z oceną

## 16. Wymagania funkcjonalne

### FR-001

System musi umożliwiać użytkownikowi zalogowanie się i dostęp wyłącznie do jego danych.

### FR-002

System musi umożliwiać utworzenie i edycję profili dwóch osób oglądających.

### FR-003

System musi umożliwiać wyszukiwanie filmów przez TMDB API.

### FR-004

System musi umożliwiać dodanie filmu do historii obejrzanych.

### FR-005

System musi umożliwiać rozpoczęcie nowej sesji wyboru filmu.

### FR-006

System musi umożliwiać zapisanie preferencji sesji.

### FR-007

System musi pobierać kandydatów filmowych z TMDB API na podstawie preferencji sesji.

### FR-008

System musi odrzucać filmy, które użytkownik oznaczył jako obejrzane.

### FR-009

System musi obniżać wynik filmów zawierających wykluczone gatunki.

### FR-010

System musi obliczać score dla każdego kandydata.

### FR-011

System musi wygenerować maksymalnie 3 rekomendacje dla sesji.

### FR-012

System musi oznaczyć każdą rekomendację jako safe pick, compromise pick lub wild card.

### FR-013

System musi wygenerować krótkie uzasadnienie rekomendacji z pomocą AI.

### FR-014

System musi umożliwiać wybór jednej rekomendacji.

### FR-015

System musi umożliwiać oznaczenie wybranego filmu jako obejrzany.

## 17. Kryteria sukcesu MVP

1. Użytkownik może przejść pełny flow: logowanie → profile → historia → sesja → rekomendacje → wybór → ocena.
2. Rekomendacje nie zawierają filmów oznaczonych jako obejrzane.
3. Rekomendacje respektują wykluczone gatunki albo wyraźnie obniżają ich score.
4. Użytkownik dostaje maksymalnie 3 rekomendacje zamiast długiej listy.
5. Każda rekomendacja ma krótkie i zrozumiałe uzasadnienie.
6. Główny flow da się przetestować testem E2E.
7. Projekt ma jasne non-goals i nie rozrasta się w stronę pełnej platformy filmowej.

## 18. Proponowany test E2E

### Scenariusz: użytkownik generuje rekomendacje dla movie night

1. Użytkownik loguje się.
2. Tworzy dwa profile oglądających.
3. Dodaje jeden film do historii obejrzanych.
4. Rozpoczyna nową sesję movie night.
5. Wybiera:
   - preferred genre: mystery / comedy,
   - excluded genre: horror,
   - max runtime: 120 minutes,
   - mood: light but engaging.
6. Klika „Generate recommendations”.
7. Aplikacja pokazuje 3 rekomendacje.
8. Żadna rekomendacja nie jest filmem z historii obejrzanych.
9. Rekomendacje mają score i krótkie uzasadnienie.
10. Użytkownik wybiera jedną rekomendację.
11. Aplikacja zapisuje wybór.
12. Użytkownik oznacza film jako obejrzany i dodaje ocenę.


## 19. Najważniejsze ryzyka

### Ryzyko 1: zbyt duży zakres

Projekt może łatwo rozrosnąć się do pełnej platformy filmowej. Trzeba pilnować, że MVP jest decision helperem, nie katalogiem filmów.

### Ryzyko 2: integracje streamingowe

Informacja „gdzie obejrzeć film” jest kusząca, ale może skomplikować projekt. W MVP nie jest wymagana.

### Ryzyko 3: AI jako czarna skrzynka

Jeśli AI będzie samodzielnie wybierać filmy bez scoringu, logika będzie trudniejsza do testowania. Dlatego rekomendacja powinna opierać się na scoringu aplikacji, a AI powinno głównie pomagać w interpretacji i uzasadnieniu.

### Ryzyko 4: zaawansowane konta par

Zapraszanie drugiej osoby linkiem, role, wspólne konta i realtime voting mogą poczekać. MVP może mieć dwa profile w ramach jednego konta.

### Ryzyko 5: zależność od TMDB API

Aplikacja powinna mieć lokalny cache filmów pobranych z TMDB oraz fallback na dane testowe w development/testach.


## 20. Minimalny pierwszy przepływ do zbudowania

Najmniejszy wartościowy flow:

1. Użytkownik loguje się.
2. Użytkownik tworzy dwa profile.
3. Użytkownik dodaje jeden obejrzany film przez TMDB search.
4. Użytkownik tworzy sesję movie night.
5. Użytkownik wybiera preferencje.
6. Aplikacja pobiera kandydatów z TMDB.
7. Aplikacja filtruje i punktuje kandydatów.
8. Aplikacja pokazuje 3 rekomendacje.
9. Użytkownik wybiera jedną.
10. Aplikacja zapisuje wybór.

To jest rdzeń projektu. Wszystko inne jest dodatkiem.

## 21. Jednozdaniowa wersja do zapamiętania

> MovieMate pomaga parze wybrać film na wieczór, pobierając kandydatów z TMDB, filtrując je według preferencji i historii oglądania, a następnie pokazując 3 uzasadnione rekomendacje zamiast kolejnej długiej listy filmów.
