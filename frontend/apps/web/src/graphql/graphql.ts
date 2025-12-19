/* ------------------------------------------------------- */
/*  THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)  */
/* ------------------------------------------------------- */

/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A date-time string at UTC, such as 2019-12-03T09:54:33Z, compliant with the date-time format. */
  DateTime: { input: any; output: any; }
  /** The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf). */
  JSON: { input: any; output: any; }
};

export type ActionConnection = Connection & {
  __typename?: 'ActionConnection';
  edges: Array<ActionEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ActionEdge = Edge & {
  __typename?: 'ActionEdge';
  cursor: Scalars['String']['output'];
  node: ActionType;
};

export type ActionType = Node & Taggable & {
  __typename?: 'ActionType';
  createdAt: Scalars['DateTime']['output'];
  id: Scalars['ID']['output'];
  imageUrl: Scalars['String']['output'];
  tags: Array<EntityTagType>;
  text: Scalars['String']['output'];
  thread?: Maybe<ThreadType>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type CommunicationConnection = Connection & {
  __typename?: 'CommunicationConnection';
  edges: Array<CommunicationEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CommunicationEdge = Edge & {
  __typename?: 'CommunicationEdge';
  cursor: Scalars['String']['output'];
  node: CommunicationType;
};

export type CommunicationType = Node & {
  __typename?: 'CommunicationType';
  content: Scalars['String']['output'];
  direction: Scalars['String']['output'];
  from?: Maybe<PersonType>;
  id: Scalars['ID']['output'];
  subject?: Maybe<Scalars['String']['output']>;
  time: Scalars['DateTime']['output'];
  to: PersonConnection;
  type: Scalars['String']['output'];
};


export type CommunicationTypeToArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type Connection = {
  edges: Array<Edge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type CreatePersonInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};

export type Edge = {
  cursor: Scalars['String']['output'];
  node: Node;
};

export type EntityTagType = {
  __typename?: 'EntityTagType';
  label: Scalars['String']['output'];
  taggedAt: Scalars['DateTime']['output'];
};

export type FactConnection = Connection & {
  __typename?: 'FactConnection';
  edges: Array<FactEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type FactEdge = Edge & {
  __typename?: 'FactEdge';
  cursor: Scalars['String']['output'];
  node: FactType;
};

export type FactType = Node & {
  __typename?: 'FactType';
  id: Scalars['ID']['output'];
};

export type FileConnection = Connection & {
  __typename?: 'FileConnection';
  edges: Array<FileEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type FileEdge = Edge & {
  __typename?: 'FileEdge';
  cursor: Scalars['String']['output'];
  node: FileType;
};

export type FileType = Node & {
  __typename?: 'FileType';
  analysisCompleted: Scalars['Boolean']['output'];
  contentType: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  filename: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  items?: Maybe<ItemConnection>;
  originalName: Scalars['String']['output'];
  size: Scalars['Float']['output'];
  updatedAt: Scalars['DateTime']['output'];
  url: Scalars['String']['output'];
};


export type FileTypeItemsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type ItemCondition =
  | 'BROKEN'
  | 'FAIR'
  | 'GOOD'
  | 'LIKE_NEW'
  | 'NA'
  | 'NEW'
  | 'POOR';

export type ItemConnection = Connection & {
  __typename?: 'ItemConnection';
  edges: Array<ItemEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ItemEdge = Edge & {
  __typename?: 'ItemEdge';
  cursor: Scalars['String']['output'];
  node: ItemType;
};

export type ItemType = Node & {
  __typename?: 'ItemType';
  acquiredAt?: Maybe<Scalars['DateTime']['output']>;
  brand?: Maybe<Scalars['String']['output']>;
  category?: Maybe<Scalars['String']['output']>;
  condition?: Maybe<ItemCondition>;
  createdAt: Scalars['DateTime']['output'];
  currency: Scalars['String']['output'];
  currentValue?: Maybe<Scalars['Float']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  file?: Maybe<FileType>;
  id: Scalars['ID']['output'];
  metadata: Scalars['JSON']['output'];
  model?: Maybe<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  subcategory?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type MessageConnection = Connection & {
  __typename?: 'MessageConnection';
  edges: Array<MessageEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type MessageEdge = Edge & {
  __typename?: 'MessageEdge';
  cursor: Scalars['String']['output'];
  node: MessageType;
};

export type MessageType = Node & {
  __typename?: 'MessageType';
  content: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  role?: Maybe<Scalars['String']['output']>;
  threadId: Scalars['ID']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  createPerson: PersonType;
  removePerson: Scalars['Boolean']['output'];
  tagEntities: Scalars['Boolean']['output'];
  untagEntities: Scalars['Boolean']['output'];
  updatePerson?: Maybe<PersonType>;
};


export type MutationCreatePersonArgs = {
  input: CreatePersonInput;
};


export type MutationRemovePersonArgs = {
  input: RemovePersonInput;
};


export type MutationTagEntitiesArgs = {
  input: TagEntitiesInput;
};


export type MutationUntagEntitiesArgs = {
  input: TagEntitiesInput;
};


export type MutationUpdatePersonArgs = {
  input: UpdatePersonInput;
};

export type Node = {
  id: Scalars['ID']['output'];
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type PersonConnection = Connection & {
  __typename?: 'PersonConnection';
  edges: Array<PersonEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type PersonEdge = Edge & {
  __typename?: 'PersonEdge';
  cursor: Scalars['String']['output'];
  node: PersonType;
};

export type PersonType = Node & Taggable & {
  __typename?: 'PersonType';
  address?: Maybe<Scalars['String']['output']>;
  avatarUrl?: Maybe<Scalars['String']['output']>;
  city?: Maybe<Scalars['String']['output']>;
  country?: Maybe<Scalars['String']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  firstName?: Maybe<Scalars['String']['output']>;
  gender?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  lastName?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  postalCode?: Maybe<Scalars['String']['output']>;
  region?: Maybe<Scalars['String']['output']>;
  streetAddress?: Maybe<Scalars['String']['output']>;
  streetAddress2?: Maybe<Scalars['String']['output']>;
  tags: Array<EntityTagType>;
};

export type Query = {
  __typename?: 'Query';
  action?: Maybe<ActionType>;
  actions: ActionConnection;
  communication?: Maybe<CommunicationType>;
  communications: CommunicationConnection;
  fact?: Maybe<FactType>;
  facts: FactConnection;
  file?: Maybe<FileType>;
  files: FileConnection;
  item?: Maybe<ItemType>;
  items: ItemConnection;
  me?: Maybe<UserType>;
  node?: Maybe<Node>;
  people: PersonConnection;
  person?: Maybe<PersonType>;
  search: SearchConnection;
  tag?: Maybe<TagType>;
  tags: TagConnection;
  thread?: Maybe<ThreadType>;
  threads: ThreadConnection;
};


export type QueryActionArgs = {
  id: Scalars['ID']['input'];
};


export type QueryActionsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryCommunicationArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCommunicationsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryFactArgs = {
  id: Scalars['ID']['input'];
};


export type QueryFactsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryFileArgs = {
  id: Scalars['ID']['input'];
};


export type QueryFilesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryItemArgs = {
  id: Scalars['ID']['input'];
};


export type QueryItemsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryNodeArgs = {
  id: Scalars['ID']['input'];
};


export type QueryPeopleArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryPersonArgs = {
  id: Scalars['ID']['input'];
};


export type QuerySearchArgs = {
  input: SearchInput;
};


export type QueryTagArgs = {
  id: Scalars['ID']['input'];
};


export type QueryTagsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryThreadArgs = {
  id: Scalars['ID']['input'];
};


export type QueryThreadsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type RemovePersonInput = {
  id: Scalars['String']['input'];
};

export type SearchConnection = {
  __typename?: 'SearchConnection';
  edges: Array<SearchResultEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type SearchInput = {
  query?: InputMaybe<Scalars['String']['input']>;
  tags?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type SearchResultEdge = {
  __typename?: 'SearchResultEdge';
  cursor: Scalars['String']['output'];
  node: SearchResultType;
};

export type SearchResultType = PersonType | ThreadType;

export type TagConnection = Connection & {
  __typename?: 'TagConnection';
  edges: Array<TagEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type TagEdge = Edge & {
  __typename?: 'TagEdge';
  cursor: Scalars['String']['output'];
  node: TagType;
};

export type TagEntitiesInput = {
  ids: Array<Scalars['ID']['input']>;
  labels: Array<Scalars['String']['input']>;
};

export type TagType = Node & {
  __typename?: 'TagType';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
};

export type Taggable = {
  tags: Array<EntityTagType>;
};

export type ThreadConnection = Connection & {
  __typename?: 'ThreadConnection';
  edges: Array<ThreadEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type ThreadEdge = Edge & {
  __typename?: 'ThreadEdge';
  cursor: Scalars['String']['output'];
  node: ThreadType;
};

export type ThreadType = Node & Taggable & {
  __typename?: 'ThreadType';
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  messages: MessageConnection;
  name?: Maybe<Scalars['String']['output']>;
  tags: Array<EntityTagType>;
};


export type ThreadTypeMessagesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdatePersonInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['String']['input'];
  name: Scalars['String']['input'];
};

export type UserType = Node & {
  __typename?: 'UserType';
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  onboarded: Scalars['Boolean']['output'];
};

export type GetActionsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetActionsQuery = { __typename?: 'Query', actions: { __typename?: 'ActionConnection', edges: Array<{ __typename?: 'ActionEdge', node: { __typename?: 'ActionType', id: string, title: string, text: string, imageUrl: string, thread?: { __typename?: 'ThreadType', id: string } | null, tags: Array<{ __typename?: 'EntityTagType', label: string }> } }> } };

export type GetInventoryItemsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetInventoryItemsQuery = { __typename?: 'Query', items: { __typename?: 'ItemConnection', edges: Array<{ __typename?: 'ItemEdge', node: { __typename?: 'ItemType', id: string, name: string, category?: string | null, description?: string | null, brand?: string | null, model?: string | null, currentValue?: number | null, file?: { __typename?: 'FileType', url: string } | null } }> } };


export const GetActionsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetActions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"actions"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"text"}},{"kind":"Field","name":{"kind":"Name","value":"imageUrl"}},{"kind":"Field","name":{"kind":"Name","value":"thread"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}},{"kind":"Field","name":{"kind":"Name","value":"tags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"label"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetActionsQuery, GetActionsQueryVariables>;
export const GetInventoryItemsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetInventoryItems"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"brand"}},{"kind":"Field","name":{"kind":"Name","value":"model"}},{"kind":"Field","name":{"kind":"Name","value":"currentValue"}},{"kind":"Field","name":{"kind":"Name","value":"file"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetInventoryItemsQuery, GetInventoryItemsQueryVariables>;