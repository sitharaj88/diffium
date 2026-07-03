export interface User {
  id: number;
  name: string;
  email: string;
}

export function findUser(users: User[], id: number): User | undefined {
  for (let i = 0; i < users.length; i++) {
    if (users[i].id === id) {
      return users[i];
    }
  }
  return undefined;
}

export function formatUser(user: User): string {
  return user.name + ' <' + user.email + '>';
}

export function sortUsers(users: User[]): User[] {
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

const DEFAULT_PAGE_SIZE = 10;

export function paginate(users: User[], page: number): User[] {
  const start = page * DEFAULT_PAGE_SIZE;
  return users.slice(start, start + DEFAULT_PAGE_SIZE);
}
