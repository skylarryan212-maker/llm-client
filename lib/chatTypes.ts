export type Source = {
  title: string;
  url: string;
  snippet?: string;
  domain?: string;
};

export type SourceChip = {
  id: number;
  title: string;
  url: string;
  domain: string;
};

export type ImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size?: number;
};
