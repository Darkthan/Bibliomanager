export function hello(name: string) {
  return `Hello, ${name}!`;
}

if (process.env.NODE_ENV !== 'test') {
  // Basic startup output for local runs
  // eslint-disable-next-line no-console
  console.log(hello('Bibliomanager2'));
}
