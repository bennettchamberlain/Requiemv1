declare global {
  /**
   * Make a set of properties optional in a type.
   *
   * @example
   * type User = { id: string; name: string; email: string };
   * type UpdateUser = Optional<User, 'email'>; // { id: string; name: string; email?: string }
   */
  type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

  /**
   * Make a set of properties required in a type.
   *
   * @example
   * type User = { id?: string; name?: string; email: string }
   * type CompleteUser = RequiredFields<User, 'id' | 'name'>;
   */
  export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
}

export {};
