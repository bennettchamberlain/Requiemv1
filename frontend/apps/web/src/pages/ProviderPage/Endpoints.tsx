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
}

export function Endpoints({ provider }: EndpointsProps) {
  const { endpoints } = useFragment(ENDPOINTS_FRAGMENT, provider);
  const form = useFormContext();

  return (
    <div className="space-y-6">
      {endpoints.map((item) => (
        <Form.Field
          key={item.name}
          control={form.control}
          name="endpoints"
          render={({ field }) => {
            return (
              <Form.Item key={item.name} className="grid grid-cols-[max-content_1fr] items-center gap-x-3">
                <Form.Control>
                  <Checkbox
                    onCheckedChange={(checked) => {
                      return checked
                        ? field.onChange([...(field.value || []), item.name])
                        : field.onChange(field.value?.filter((value: string) => value !== item.name));
                    }}
                  />
                </Form.Control>

                <Form.Label className="font-medium cursor-pointer">{item.name}</Form.Label>
                <Form.Label className="col-start-2 font-light text-muted-foreground cursor-pointer leading-normal">
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
