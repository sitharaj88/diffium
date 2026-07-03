export interface User {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

export function findUser(users: User[], id: number): User | undefined {
  return users.find((user) => user.id === id);
}

export function formatUser(user: User): string {
  const status = user.isActive ? '' : ' (inactive)';
  return `${user.name} <${user.email}>${status}`;
}

export function sortUsers(users: User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

const DEFAULT_PAGE_SIZE = 25;

export function paginate(users: User[], page: number, pageSize = DEFAULT_PAGE_SIZE): User[] {
  const start = page * pageSize;
  return users.slice(start, start + pageSize);
}
