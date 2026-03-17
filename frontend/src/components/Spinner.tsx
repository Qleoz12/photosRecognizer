interface Props {
  message?: string;
}

export default function Spinner({ message }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-10 h-10 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
      {message && <p className="text-gray-400 text-sm">{message}</p>}
    </div>
  );
}
