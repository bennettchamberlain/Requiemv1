# Database Architecture
The core concepts of the database are:
- All "things that a user might care about" are pulled into a graph-like structure of "entities" and "relationships". 
- Both of these have a JSONB field called "properties" that is intended to store most all of the information about that thing.
- Each node should have at least one relationship.
- Relationships express the, well, relationships between nodes.
- Anything a user might ever search should carry an embedding.
- Retain as much data as you can. Retain full responses from APIs (not necessarily their syntactic sugar, but retain all the content)
- Because so many fields are JSONB, we should simultaneously be consistent and transparent with the "sub-schemas" of the properties fields, and not be afraid to add new fields. This properties should evolve with the user.

## Entities
Both of these have a JSONB field called "properties" that is intended to store most all of the information about that thing. For instance, John Smith has a properties that looks like this:
{
"age": 42,
"bio": "Software engineer and family man who loves organizing family activities",
"email": "john.smith@family.com",
"last_name": "Smith",
"first_name": "John",
"occupation": "Software Engineer",
"family_role": "father"
}
Because this is a totally mutable field, the ONUS IS ON APPLICATION LAYER LOGIC TO USE CONSISTENT FIELDS. JSONB is also searchable, so we can easily query inside the properties.
`Entities` are not just people, but also concepts like "Country Music" or "Coffee". Coffee has properties like this:
{
"type": "food",
"subtype": "beverage"
"origin": "Ethiopia",
"category": "Hot/Caffeinated",
"varieties": [
"Espresso",
"Americano",
"Latte",
"Cappuccino"
],
"caffeine_content": "High"
}
Some example entities are:
- Person
- Concept
- Location
- Object
- Event
- Goal

## Relationships
Each node should have at least one relationship. Relationships express the, well, relationships between nodes. For instance, the `relationships` table has an entry with FKs between John Smith and coffee, with a relationship_type "PREFERS", and
properties
{
"since": "2021-01-18T13:29:31.352416",
"tyoe": "food",
"context": "always loved",
"strength": 0.8
}

Some example relationships are:
- PREFERS
- DISLIKES
- KNOWS
- WORKS_WITH
- COLLABORATED_WITH
- LIVES_IN
- STUDIES_AT
- WORKS_AT
- LIVES_NEAR
- VISITED
- OWNS
- INTERESTED_IN
- CREATED
- MENTORED
- TAUGHT
- LEARNED_FROM
- PARTICIPATED_IN
- SPOUSE
- PARENT_OF
- CHILD_OF
- SIBLING_OF
- FAMILY_MEMBER

This way we can identify things like the preferences and who shares those preferences in an easy to reckon graph schema. The old tables People, Contacts, Things, Places, Locations, etc are all rolled into this new schema.


# Where to put what?
The astute reader will notice that the `entities` table explicitly has "things" and there are `relationships` like "owns", yet we also have an `inventory` table.
A fair question for this data model is "How do I know whether to make a graph entitiy or enter something in the relationsal tables?
As a rule of thumb, if a user owns an item, it should be in hte inventory table, but not necessarily in the entities table.
The full answer ultimately comes down to the percieved human relationship with the item. For instance, if the user has a set of screws, they likely do not have a parasocial relaitonship with them. `Inventory` table. The user has a car that they got from their grandmother which they call "Schotkey" and need to pat it on the dashboard to get it to start in the cold. Both `Inventory` and `Entities`. 

# Documents and Files.
 As the system acquires the knowledge of files, either by being uploaded or discovered, it should log them in the `files` table. The `files` also contains `file_entity_id` if the file being represented also bears emotional significance (a zip of wedding photos, a book you've been writing). If the file is just a random pdf you downloaded, it should not have an entity. 

 Documents are a special subtype of file, because there is just so much easily parsed information in documents (here meaning any primarily text based file). Documents are nominally chunked up into `document chunks`, which are rag-searchable via the embedding functionality. `document_chunks` should also be decomposed into `facts`. 

 # Facts

 `facts` is a special subtype of `entitiy` that does not exist in the graph. Nominally, facts are atomic units of information. Because _concepts_ are represented as entities, it is logical then to represent facts as such too, however, because facts are voluminous and can be extracted en mass from, say, a book, they should not live in the `entities` table (unless otherwise necessary).
 The `facts` table is also where old nodes go to die. As part of a future TBD process, we will prune information from the `entities` and `relationships` table and store them in "cold storage" in the facts table. When removing nodes, compress the original entitiy information (including entity id) and _outgoing edges_ into the fact. This is _intended_ to leave dangling edges on nodes that remain in the graph- if the database ever needs to traverse that graph, a simple sql `COALESCE`.
 This then means that technically `facts` reepresents a graph in and of itself, though it is not designed to be queries as such, and is expected to be highly disjoint.

 # Measurements, Position, Sensors, and Devices.
 These tables are designed to support IOT and health metrics. The heirarchy is as such: `Devices` (like a smart watch) have `Sensors`, and `Sensors` have `Measurements`. Measurements should be as fine grained as the device API will allow. If the device doesn't break out its individual sensors (it is expected that they won't) then the `sensor_name` should be some composite of the `device_name` and `measurement_type`.
 Measurements are stored as hypertables, so please record everything.
 `Position` is a special kind of measurement for GPS (and other) coodinates. `Position` also supports relative coordinates and relative orientation, to support headpose for AR applications. Relative cooedinates are relative to an `entity` (or `fact`), which should be considered to be the origin for the relative spatial system. For instance, if the user is in a minecraft world and we can get the coordinates of the player pawn, then that information should go in the `relative_coordinates` field. This is also a hyper table.

