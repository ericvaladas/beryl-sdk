export interface ClientDescriptor {
  pid: number;
  port: number;
  name: string;
}

export interface Settings {
  allowedOrigins: string[];
}
