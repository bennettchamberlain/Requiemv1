import { Button, Form, Input, Select, useFieldArray, useFormContext } from '@ci/shadcn';
import { X } from '@ci/shadcn/icons';

import { StepHeader } from './StepHeader';

type Person = {
  first: string;
  last: string;
  relationship: string;
};

const RELATIONSHIP_GROUPS = [
  {
    label: 'Family',
    options: [
      { value: 'partner', label: 'Partner' },
      { value: 'parent', label: 'Parent' },
      { value: 'child', label: 'Child' },
    ],
  },
  {
    label: 'Social',
    options: [
      { value: 'roommate', label: 'Roommate' },
      { value: 'friend', label: 'Friend' },
      { value: 'coworker', label: 'Co-worker' },
    ],
  },
  {
    label: 'Other',
    options: [{ value: 'complicated', label: "It's complicated" }],
  },
];

export function SocialConnections() {
  const form = useFormContext<{ people: Person[] }>();
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'people',
  });

  const count = form.watch('people')?.length ?? 0;
  const canAdd = count < 6;

  return (
    <div className="space-y-6 w-full max-w-2xl mx-auto">
      <StepHeader
        title="Who are you usually around?"
        description="Let's start with up to 6 for now."
      />

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_max-content_max-content] items-center gap-3 px-1 mx-auto">
        {fields.map((field, index) => (
          <Form.Field
            key={field.id}
            control={form.control}
            // We don’t bind "name" here because we render 3 sub-fields below
            name={`people.${index}.first` as const}
            render={() => (
              <>
                {/* First Name */}
                <Form.Item>
                  <Form.Control>
                    <Form.Field
                      control={form.control}
                      name={`people.${index}.first`}
                      render={({ field }) => (
                        <Input {...field} placeholder="First" className="w-full h-12 text-lg" />
                      )}
                    />
                  </Form.Control>
                  <Form.Message />
                </Form.Item>

                {/* Last Name */}
                <Form.Item>
                  <Form.Control>
                    <Form.Field
                      control={form.control}
                      name={`people.${index}.last`}
                      render={({ field }) => (
                        <Input {...field} placeholder="Last" className="w-full h-12 text-lg" />
                      )}
                    />
                  </Form.Control>
                  <Form.Message />
                </Form.Item>

                {/* Relationship (Select) */}
                <Form.Item className="min-w-0">
                  <Form.Control>
                    <Form.Field
                      control={form.control}
                      name={`people.${index}.relationship`}
                      render={({ field }) => (
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                          <Select.Trigger className="w-28 md:w-36 h-12 text-base overflow-hidden truncate min-w-0">
                            <Select.Value placeholder="Relation" />
                          </Select.Trigger>
                          <Select.Content>
                            {RELATIONSHIP_GROUPS.map((group) => (
                              <Select.Group key={group.label}>
                                <Select.Label>{group.label}</Select.Label>
                                {group.options.map((opt) => (
                                  <Select.Item key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </Select.Item>
                                ))}
                              </Select.Group>
                            ))}
                          </Select.Content>
                        </Select>
                      )}
                    />
                  </Form.Control>
                  <Form.Message />
                </Form.Item>

                <Button
                  className="-ml-2 -mr-1 cursor-pointer"
                  type="button"
                  size="lg"
                  variant="ghost"
                  onClick={() => remove(index)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </>
            )}
          />
        ))}
      </div>

      <div className="text-center">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="text-base"
          onClick={() => append({ first: '', last: '', relationship: '' })}
          disabled={!canAdd}
        >
          Add another person
        </Button>
      </div>
    </div>
  );
}
