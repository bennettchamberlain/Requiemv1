import { useEffect } from 'react';

import { Checkbox, Form, useFormContext } from '@ci/shadcn';

import { gql } from '@/graphql';
import { type FragmentType, useFragment } from '@/graphql/fragment-masking';

export const ENDPOINTS_FRAGMENT = gql(`
  fragment ProviderEndpointsFragment on ProviderType {
    endpoints {
      name
      description
    }
  }
`);

interface EndpointsProps {
  provider: FragmentType<typeof ENDPOINTS_FRAGMENT>;
  startEndpoints?: string[];
}

export function Endpoints({ provider, startEndpoints }: EndpointsProps) {
  const { endpoints } = useFragment(ENDPOINTS_FRAGMENT, provider);
  const form = useFormContext();

  useEffect(() => {
    form.setValue('endpoints', startEndpoints || []);
  }, []);

  return (
    <div className="space-y-6">
      {form &&
        endpoints.map((item) => (
          <Form.Field
            key={item.name}
            control={form.control}
            name="endpoints"
            render={({ field }) => {
              return (
                <Form.Item key={item.name} className="grid grid-cols-[max-content_1fr] items-center gap-x-3">
                  <Form.Control>
                    <Checkbox
                      checked={field.value?.includes(item.name)}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...(field.value || []), item.name]
                          : (field.value || []).filter((value: string) => value !== item.name);

                        field.onChange(next);
                      }}
                    />
                  </Form.Control>

                  <Form.Label className="font-medium cursor-pointer">{item.name}</Form.Label>
                  <Form.Label className="col-start-2 text-muted-foreground cursor-pointer leading-normal font-normal">
                    {item.description}
                  </Form.Label>
                </Form.Item>
              );
            }}
          />
        ))}
    </div>
  );
}
